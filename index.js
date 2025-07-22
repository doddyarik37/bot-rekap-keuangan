const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const TOKEN = process.env.TELEGRAM_TOKEN;
const SPREADSHEET_API = process.env.SPREADSHEET_API;

if (!TOKEN || !SPREADSHEET_API) {
  console.error('Error: Pastikan TELEGRAM_TOKEN dan SPREADSHEET_API sudah diatur di Environment Variables Railway.');
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });
const pendingData = {};

// --- Perintah untuk "membangunkan" bot ---
bot.onText(/^\/lur$/, (msg) => {
  bot.sendMessage(msg.chat.id, 'Wett! 👋');
});

// --- BARU: Perintah untuk menampilkan daftar perintah ---
bot.onText(/^\/?perintah$/, (msg) => {
    const chatId = msg.chat.id;
    const helpText = `
*Daftar Perintah Bot Keuangan*

*Pencatatan Dasar:*
• \`masuk [nominal] [ket] [sumber]\`
  _Contoh: \`masuk 50000 Gaji bank\`_
• \`keluar [nominal] [ket] [sumber]\`
  _Contoh: \`keluar 25000 Makan siang ewallet\`_
• \`tf [nominal] [dari] [ke]\`
  _Contoh: \`tf 100000 bank cash\`_

*Melihat Data:*
• \`saldo\` - Menampilkan ringkasan saldo total & per sumber.
• \`rekap\` - Menampilkan daftar semua transaksi dengan nomor barisnya.
• \`rekap [sumber]\` - Menampilkan daftar transaksi per sumber (cash/bank/ewallet).

*Mengubah Data:*
(Gunakan nomor baris dari hasil \`rekap\`)
• \`hapus [no. baris]\`
  _Contoh: \`hapus 5\`_
• \`edit [no. baris] [nominal] [ket] [sumber]\`
  _Contoh: \`edit 5 30000 Makan malam cash\`_

*Lainnya:*
• \`/lur\` - Memastikan bot aktif.
    `;
    bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
});


// 🔹 Masuk
bot.onText(/^masuk (\d+)\s+(.+)\s+(cash|bank|ewallet)$/i, (msg, match) => {
  const chatId = msg.chat.id;
  const [ , nominal, keterangan, sumber ] = match;
  pendingData[chatId] = { action: 'add', tipe: 'masuk', nominal, keterangan, sumber };
  bot.sendMessage(chatId, '📸 Kirim foto struk jika ada, atau balas *tidak* bila tidak ada', { parse_mode: 'Markdown' });
});

// 🔹 Keluar
bot.onText(/^keluar (\d+)\s+(.+)\s+(cash|bank|ewallet)$/i, (msg, match) => {
  const chatId = msg.chat.id;
  const [ , nominal, keterangan, sumber ] = match;
  pendingData[chatId] = { action: 'add', tipe: 'keluar', nominal, keterangan, sumber };
  bot.sendMessage(chatId, '📸 Kirim foto struk jika ada, atau balas *tidak* bila tidak ada', { parse_mode: 'Markdown' });
});

// 🔸 Jika tidak ada foto (untuk 'masuk' atau 'keluar')
bot.onText(/^tidak$/i, async msg => {
  const chatId = msg.chat.id;
  const data = pendingData[chatId];
  if (!data || data.action !== 'add') return;
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

// 🔸 Jika ada foto struk (untuk 'masuk' atau 'keluar')
bot.on('photo', async msg => {
  const chatId = msg.chat.id;
  const data = pendingData[chatId];
  if (!data || data.action !== 'add') return;
  try {
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const fileUrl = await bot.getFileLink(fileId);
    // Menambahkan link bukti ke data yang akan dikirim
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
    action: 'add', // Menandai aksi sebagai 'add'
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

// 🗑️ Hapus transaksi
bot.onText(/^hapus (\d+)$/i, async (msg, match) => {
    const chatId = msg.chat.id;
    const rowNumber = parseInt(match[1]);
    if (rowNumber < 3) {
        bot.sendMessage(chatId, "❌ Nomor baris tidak valid. Harap mulai dari baris 3.");
        return;
    }
    try {
        const payload = { action: 'delete', rowNumber: rowNumber };
        await axios.post(SPREADSHEET_API, payload);
        bot.sendMessage(chatId, `✅ Transaksi pada baris ${rowNumber} berhasil dihapus.`);
        await tampilkanSaldo(chatId);
    } catch (error) {
        console.error('Gagal hapus data:', error.message);
        bot.sendMessage(chatId, `❌ Gagal menghapus data pada baris ${rowNumber}. Pastikan nomor baris benar.`);
    }
});

// ✏️ Edit transaksi
bot.onText(/^edit (\d+) (\d+) (.+) (cash|bank|ewallet)$/i, async (msg, match) => {
    const chatId = msg.chat.id;
    const [ , rowNumber, nominal, keterangan, sumber ] = match;
    if (parseInt(rowNumber) < 3) {
        bot.sendMessage(chatId, "❌ Nomor baris tidak valid. Harap mulai dari baris 3.");
        return;
    }
    try {
        const payload = {
            action: 'edit',
            rowNumber: parseInt(rowNumber),
            nominal: parseInt(nominal),
            keterangan: keterangan,
            sumber: sumber
        };
        await axios.post(SPREADSHEET_API, payload);
        bot.sendMessage(chatId, `✅ Transaksi pada baris ${rowNumber} berhasil diubah.`);
        await tampilkanSaldo(chatId);
    } catch (error) {
        console.error('Gagal edit data:', error.message);
        bot.sendMessage(chatId, `❌ Gagal mengubah data pada baris ${rowNumber}. Pastikan format perintah dan nomor baris benar.`);
    }
});

// 📊 Rekap transaksi (menampilkan daftar)
bot.onText(/^rekap(?:\s+(cash|bank|ewallet))?$/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const sumber = match[1];
  try {
    let url = SPREADSHEET_API;
    if (sumber) {
      url += `?sumber=${sumber}`;
    }
    const res = await axios.get(url);
    const transactions = res.data.transactions;
    let replyText = '';
    if (sumber) {
        replyText = `📊 *Daftar Transaksi Sumber: ${sumber.toUpperCase()}*\n\n`;
    } else {
        replyText = `📊 *Daftar Semua Transaksi*\n\n`;
    }
    if (!transactions || transactions.length === 0) {
        replyText += 'Tidak ada transaksi ditemukan.';
    } else {
        transactions.forEach(t => {
            const icon = t.tipe === 'masuk' ? '🟢' : (t.tipe === 'keluar' ? '🔴' : '🔄');
            const nominalFormatted = t.nominal.toLocaleString('id-ID');
            const linkBukti = t.bukti ? ` [Lihat Struk](${t.bukti})` : '';
            replyText += `*${t.row}.* ${icon} *Rp${nominalFormatted}* - ${t.keterangan} (${t.sumber})${linkBukti}\n`;
        });
    }
    bot.sendMessage(chatId, replyText, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error('Gagal ambil rekap:', e.message);
    bot.sendMessage(chatId, '❌ Gagal mengambil data rekap.');
  }
});

// 💰 Saldo total & per sumber
bot.onText(/^saldo$/i, async (msg) => {
  await tampilkanSaldo(msg.chat.id);
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
