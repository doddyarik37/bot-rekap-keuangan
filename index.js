const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// --- PENTING ---
// Ambil token dan URL dari Environment Variables di Railway
// Jangan tulis token Anda di sini!
const TOKEN = process.env.TELEGRAM_TOKEN;
const SPREADSHEET_API = process.env.SPREADSHEET_API;

if (!TOKEN || !SPREADSHEET_API) {
  console.error('Error: Pastikan TELEGRAM_TOKEN dan SPREADSHEET_API sudah diatur di Environment Variables Railway.');
  process.exit(1); // Hentikan bot jika variabel tidak ada
}

const bot = new TelegramBot(TOKEN, { polling: true });
const pendingData = {};

// --- BARU: Perintah untuk "membangunkan" bot ---
bot.onText(/^\/start$/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, '👋 Bot aktif dan siap mencatat!');
});


// 🔹 Masuk
bot.onText(/^masuk (\d+)\s+(.+)\s+(cash|bank|ewallet)$/i, (msg, match) => {
  const chatId = msg.chat.id;
  const [ , nominal, keterangan, sumber ] = match;

  pendingData[chatId] = { tipe: 'masuk', nominal, keterangan, sumber };
  bot.sendMessage(chatId, '📸 Kirim foto struk jika ada, atau balas *tidak* bila tidak ada', { parse_mode: 'Markdown' });
});

// 🔹 Keluar
bot.onText(/^keluar (\d+)\s+(.+)\s+(cash|bank|ewallet)$/i, (msg, match) => {
  const chatId = msg.chat.id;
  const [ , nominal, keterangan, sumber ] = match;

  pendingData[chatId] = { tipe: 'keluar', nominal, keterangan, sumber };
  bot.sendMessage(chatId, '📸 Kirim foto struk jika ada, atau balas *tidak* bila tidak ada', { parse_mode: 'Markdown' });
});

// 🔸 Jika tidak ada foto
bot.onText(/^tidak$/i, async msg => {
  const chatId = msg.chat.id;
  const data = pendingData[chatId];
  if (!data) return;

  try {
    await axios.post(SPREADSHEET_API, data);
    delete pendingData[chatId];
    bot.sendMessage(chatId, '✅ Transaksi berhasil dicatat.');
    await tampilkanSaldo(chatId);
  } catch (error) {
    console.error('Gagal kirim data (tanpa foto):', error.message);
    bot.sendMessage(chatId, '❌ Gagal menyimpan data. Coba lagi.');
  }
});

// 🔸 Jika ada foto struk
bot.on('photo', async msg => {
  const chatId = msg.chat.id;
  const data = pendingData[chatId];
  if (!data) return;

  try {
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const fileUrl = await bot.getFileLink(fileId);
    await axios.post(SPREADSHEET_API, { ...data, bukti: fileUrl });
    delete pendingData[chatId];
    bot.sendMessage(chatId, '✅ Transaksi dan struk berhasil dicatat.');
    await tampilkanSaldo(chatId);
  } catch (error) {
    console.error('Gagal kirim data (dengan foto):', error.message);
    bot.sendMessage(chatId, '❌ Gagal menyimpan data. Coba lagi.');
  }
});

// 🔄 Transfer antar dompet
bot.onText(/^tf (\d+)\s+(cash|bank|ewallet)\s+(cash|bank|ewallet)$/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const [ , nominal, sumber, tujuan ] = match;
  const data = {
    tipe: 'transfer',
    nominal,
    keterangan: `Transfer dari ${sumber} ke ${tujuan}`,
    sumber,
    tujuan
  };

  try {
    await axios.post(SPREADSHEET_API, data);
    bot.sendMessage(chatId, '🔁 Transfer antar dompet berhasil dicatat.');
    await tampilkanSaldo(chatId);
  } catch (error) {
    console.error('Gagal kirim data (transfer):', error.message);
    bot.sendMessage(chatId, '❌ Gagal menyimpan data transfer. Coba lagi.');
  }
});

// 📊 Rekap total masuk & keluar (umum atau per sumber)
bot.onText(/^rekap(?:\s+(cash|bank|ewallet))?$/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const sumber = match[1]; // Akan berisi 'cash', 'bank', 'ewallet', atau undefined

  try {
    let url = SPREADSHEET_API;
    if (sumber) {
      // Menambahkan parameter sumber ke URL jika ada
      url += `?sumber=${sumber}`;
    }

    const res = await axios.get(url);
    const d = res.data;
    let replyText = '';

    if (sumber) {
      // Balasan untuk rekap spesifik per sumber
      const namaSumber = sumber.charAt(0).toUpperCase() + sumber.slice(1);
      replyText = `📊 *Rekap Sumber: ${namaSumber}*\n` +
                  `🟢 Total Masuk: Rp${d.totalMasuk.toLocaleString('id-ID')}\n` +
                  `🔴 Total Keluar: Rp${d.totalKeluar.toLocaleString('id-ID')}\n` +
                  `💰 *Saldo Akhir ${namaSumber}: Rp${d.saldoAkhir.toLocaleString('id-ID')}*`;
    } else {
      // Balasan untuk rekap umum (seperti sebelumnya)
      replyText = `📊 *Rekap Transaksi Total:*\n` +
                  `🟢 Total Masuk: Rp${d.totalMasuk.toLocaleString('id-ID')}\n` +
                  `🔴 Total Keluar: Rp${d.totalKeluar.toLocaleString('id-ID')}`;
    }

    bot.sendMessage(chatId, replyText, { parse_mode: 'Markdown' });

  } catch (e) {
    console.error('Gagal ambil rekap:', e.message);
    bot.sendMessage(chatId, '❌ Gagal mengambil data rekap.');
  }
});


// 💰 Saldo total & per sumber
bot.onText(/^saldo$/i, async msg => {
  const chatId = msg.chat.id;
  await tampilkanSaldo(chatId);
});

// 🔧 Fungsi tampilkan saldo (dipakai berulang)
async function tampilkanSaldo(chatId) {
  try {
    const res = await axios.get(SPREADSHEET_API);
    const d = res.data;

    const saldoCash = d.saldoPerSumber.cash || 0;
    const saldoBank = d.saldoPerSumber.bank || 0;
    const saldoEwallet = d.saldoPerSumber.ewallet || 0;

    bot.sendMessage(chatId,
      `💰 *Saldo Saat Ini:*\n` +
      `💵 Rp${d.saldoAkhir.toLocaleString('id-ID')}\n\n` +
      `📦 Cash: Rp${saldoCash.toLocaleString('id-ID')}\n` +
      `🏦 Bank: Rp${saldoBank.toLocaleString('id-ID')}\n` +
      `📱 Ewallet: Rp${saldoEwallet.toLocaleString('id-ID')}`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) {
    console.error('Gagal ambil saldo:', e.message);
    bot.sendMessage(chatId, '❌ Gagal mengambil saldo terkini.');
  }
}

console.log('Bot catatan keuangan berhasil dijalankan...');
