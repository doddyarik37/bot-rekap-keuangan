const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const TOKEN = process.env.TOKEN;
const SPREADSHEET_API = process.env.SPREADSHEET_API;

const bot = new TelegramBot(TOKEN, { polling: true });
const pendingData = {};

bot.onText(/^#(dapat|bayar) (\d+)\s+(.+)\s+(cash|bank|ewallet)$/i, (msg, match) => {
  const chatId = msg.chat.id;
  const tipe = match[1];
  const nominal = match[2];
  const keterangan = match[3];
  const sumber = match[4];

  pendingData[chatId] = { tipe, nominal, keterangan, sumber };
  bot.sendMessage(chatId, '📸 Kirim foto struk jika ada, atau balas *tidak* bila tidak ada');
});

bot.onText(/^tidak$/i, async msg => {
  const chatId = msg.chat.id;
  const data = pendingData[chatId];
  if (!data) return;

  await axios.post(SPREADSHEET_API, data);
  delete pendingData[chatId];

  try {
    const res = await axios.get(SPREADSHEET_API);
    const d = res.data;
    bot.sendMessage(chatId,
      `✅ Transaksi dicatat tanpa struk.\n\n` +
      `📊 *Saldo Saat Ini:*\n` +
      `💰 Saldo: Rp${d.saldoAkhir.toLocaleString()}\n` +
      `🟢 Masuk: Rp${d.totalMasuk.toLocaleString()}\n` +
      `🔴 Keluar: Rp${d.totalKeluar.toLocaleString()}`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) {
    bot.sendMessage(chatId, '📝 Data dicatat, tapi gagal mengambil saldo.');
  }
});

bot.on('photo', async msg => {
  const chatId = msg.chat.id;
  const data = pendingData[chatId];
  if (!data) return;

  const fileId = msg.photo[msg.photo.length - 1].file_id;
  const file = await bot.getFileLink(fileId);
  await axios.post(SPREADSHEET_API, { ...data, bukti: file.href });
  delete pendingData[chatId];

  try {
    const res = await axios.get(SPREADSHEET_API);
    const d = res.data;
    bot.sendMessage(chatId,
      `✅ Transaksi dan struk berhasil dicatat.\n\n` +
      `📊 *Saldo Saat Ini:*\n` +
      `💰 Saldo: Rp${d.saldoAkhir.toLocaleString()}\n` +
      `🟢 Masuk: Rp${d.totalMasuk.toLocaleString()}\n` +
      `🔴 Keluar: Rp${d.totalKeluar.toLocaleString()}`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) {
    bot.sendMessage(chatId, '📝 Data dicatat, tapi gagal mengambil saldo.');
  }
});

bot.onText(/^#rekap$/i, async msg => {
  const chatId = msg.chat.id;
  try {
    const res = await axios.get(SPREADSHEET_API);
    const d = res.data;
    bot.sendMessage(chatId,
      `📊 *Rekap Keuangan Saat Ini:*\n` +
      `💰 Saldo: Rp${d.saldoAkhir.toLocaleString()}\n` +
      `🟢 Masuk: Rp${d.totalMasuk.toLocaleString()}\n` +
      `🔴 Keluar: Rp${d.totalKeluar.toLocaleString()}`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) {
    bot.sendMessage(chatId, '❌ Gagal mengambil data rekap.');
  }
});

bot.onText(/^#rekap (cash|bank|ewallet)$/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const sumber = match[1];
  try {
    const res = await axios.get(SPREADSHEET_API);
    const d = res.data;
    const saldo = d.saldoPerSumber[sumber] || 0;
    bot.sendMessage(chatId,
      `💼 *Saldo ${sumber}:* Rp${saldo.toLocaleString()}`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) {
    bot.sendMessage(chatId, '❌ Gagal mengambil data rekap.');
  }
});

bot.onText(/^#tf (\d+)\s+(cash|bank|ewallet)\s+(cash|bank|ewallet)$/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const nominal = parseInt(match[1]);
  const sumber = match[2];
  const tujuan = match[3];

  if (sumber === tujuan) {
    return bot.sendMessage(chatId, '⚠️ Sumber dan tujuan transfer tidak boleh sama.');
  }

  const data = {
    tipe: 'transfer',
    nominal,
    keterangan: `Transfer dari ${sumber} ke ${tujuan}`,
    sumber,
    tujuan
  };

  try {
    await axios.post(SPREADSHEET_API, data);

    const res = await axios.get(SPREADSHEET_API);
    const d = res.data;

    bot.sendMessage(chatId,
      `🔄 Transfer Rp${nominal.toLocaleString()} dari *${sumber}* ke *${tujuan}* berhasil.\n\n` +
      `📊 *Saldo Sekarang:*\n` +
      `💼 ${sumber}: Rp${(d.saldoPerSumber[sumber] || 0).toLocaleString()}\n` +
      `💼 ${tujuan}: Rp${(d.saldoPerSumber[tujuan] || 0).toLocaleString()}`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) {
    bot.sendMessage(chatId, '❌ Gagal mencatat transfer atau mengambil saldo.');
  }
});
