const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const TOKEN = '7881807901:AAEyCpZopNLeIVC_90cNoSFQmk_Ga8BBFZE';
const SPREADSHEET_API = 'https://script.google.com/macros/s/AKfycbwIK2w02JzP-p9HCDaUVoOdNmEDffbrIirs0NFpLfPNALMLFfJ0-4m4PtF52tc1YucvrQ/exec';

const bot = new TelegramBot(TOKEN, { polling: true });
const pendingData = {};

// Transaksi masuk (dapat)
bot.onText(/^masuk (\d+)\s+(.+)\s+(cash|bank|ewallet)$/i, (msg, match) => {
  const chatId = msg.chat.id;
  const [ , nominal, keterangan, sumber ] = match;

  pendingData[chatId] = { tipe: 'dapat', nominal, keterangan, sumber };
  bot.sendMessage(chatId, '📸 Kirim foto struk jika ada, atau balas *tidak* bila tidak ada');
});

// Transaksi keluar (bayar)
bot.onText(/^keluar (\d+)\s+(.+)\s+(cash|bank|ewallet)$/i, (msg, match) => {
  const chatId = msg.chat.id;
  const [ , nominal, keterangan, sumber ] = match;

  pendingData[chatId] = { tipe: 'bayar', nominal, keterangan, sumber };
  bot.sendMessage(chatId, '📸 Kirim foto struk jika ada, atau balas *tidak* bila tidak ada');
});

// Jika tidak ada foto
bot.onText(/^tidak$/i, async msg => {
  const chatId = msg.chat.id;
  const data = pendingData[chatId];
  if (!data) return;

  await axios.post(SPREADSHEET_API, data);
  delete pendingData[chatId];

  bot.sendMessage(chatId, '✅ Transaksi berhasil dicatat.');

  try {
    const res = await axios.get(SPREADSHEET_API);
    const d = res.data;
    bot.sendMessage(chatId,
      `💰 *Saldo Saat Ini:*\n` +
      `💵 Rp${d.saldoAkhir.toLocaleString()}\n\n` +
      `📦 Cash: Rp${saldoCash.toLocaleString()}\n` +
      `🏦 Bank: Rp${saldoBank.toLocaleString()}\n` +
      `📱 Ewallet: Rp${saldoEwallet.toLocaleString()}`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) {
    bot.sendMessage(chatId, '📝 Data dicatat, tapi gagal mengambil saldo.');
  }
});

// Jika ada foto struk
bot.on('photo', async msg => {
  const chatId = msg.chat.id;
  const data = pendingData[chatId];
  if (!data) return;

  const fileId = msg.photo[msg.photo.length - 1].file_id;
  const fileUrl = await bot.getFileLink(fileId);
  await axios.post(SPREADSHEET_API, { ...data, bukti: fileUrl });
  delete pendingData[chatId];

  bot.sendMessage(chatId, '✅ Transaksi berhasil dicatat.');

  try {
    const res = await axios.get(SPREADSHEET_API);
    const d = res.data;
    bot.sendMessage(chatId,
      `💰 *Saldo Saat Ini:*\n` +
      `💵 Rp${d.saldoAkhir.toLocaleString()}\n\n` +
      `📦 Cash: Rp${saldoCash.toLocaleString()}\n` +
      `🏦 Bank: Rp${saldoBank.toLocaleString()}\n` +
      `📱 Ewallet: Rp${saldoEwallet.toLocaleString()}`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) {
    bot.sendMessage(chatId, '📝 Data dicatat, tapi gagal mengambil saldo.');
  }
});

// Rekap total pemasukan & pengeluaran
bot.onText(/^rekap$/i, async msg => {
  const chatId = msg.chat.id;
  delete pendingData[chatId];

  try {
    const res = await axios.get(SPREADSHEET_API);
    const d = res.data;
    bot.sendMessage(chatId,
      `📊 *Rekap Transaksi:*\n` +
      `🟢 Total Masuk: Rp${d.totalMasuk.toLocaleString()}\n` +
      `🔴 Total Keluar: Rp${d.totalKeluar.toLocaleString()}`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) {
    bot.sendMessage(chatId, '❌ Gagal mengambil data rekap.');
  }
});

// Saldo total & per sumber
bot.onText(/^saldo$/i, async msg => {
  const chatId = msg.chat.id;
  delete pendingData[chatId];

  try {
    const res = await axios.get(SPREADSHEET_API);
    const d = res.data;
    const saldoCash = d.saldoPerSumber.cash || 0;
    const saldoBank = d.saldoPerSumber.bank || 0;
    const saldoEwallet = d.saldoPerSumber.ewallet || 0;

    bot.sendMessage(chatId,
      `💰 *Saldo Saat Ini:*\n` +
      `🟢 Total Saldo: Rp${d.saldoAkhir.toLocaleString()}\n\n` +
      `💼 Rincian:\n` +
      `📦 Cash: Rp${saldoCash.toLocaleString()}\n` +
      `🏦 Bank: Rp${saldoBank.toLocaleString()}\n` +
      `📱 Ewallet: Rp${saldoEwallet.toLocaleString()}`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) {
    bot.sendMessage(chatId, '❌ Gagal mengambil data saldo.');
  }
});

// Transfer antar sumber
bot.onText(/^tf (\d+)\s+(cash|bank|ewallet)\s+(cash|bank|ewallet)$/i, async (msg, match) => {
  const chatId = msg.chat.id;
  delete pendingData[chatId];

  const [ , nominal, sumber, tujuan ] = match;
  const data = {
    tipe: 'transfer',
    nominal,
    keterangan: `Transfer dari ${sumber} ke ${tujuan}`,
    sumber,
    tujuan
  };

  await axios.post(SPREADSHEET_API, data);
  bot.sendMessage(chatId, '🔁 Transfer antar dompet berhasil dicatat.');

  try {
    const res = await axios.get(SPREADSHEET_API);
    const d = res.data;
    bot.sendMessage(chatId,
      `💰 *Saldo Saat Ini:*\n` +
      `💵 Rp${d.saldoAkhir.toLocaleString()}\n\n` +
      `📦 Cash: Rp${saldoCash.toLocaleString()}\n` +
      `🏦 Bank: Rp${saldoBank.toLocaleString()}\n` +
      `📱 Ewallet: Rp${saldoEwallet.toLocaleString()}`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) {
    bot.sendMessage(chatId, '📝 Transfer dicatat, tapi gagal ambil saldo.');
  }
});
