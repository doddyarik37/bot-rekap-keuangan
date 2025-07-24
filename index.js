const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const cron = require('node-cron');

const TOKEN = process.env.TELEGRAM_TOKEN;
const SPREADSHEET_API = process.env.SPREADSHEET_API;

if (!TOKEN || !SPREADSHEET_API) {
  console.error('Error: Pastikan TELEGRAM_TOKEN dan SPREADSHEET_API sudah diatur di Environment Variables Railway.');
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });
const pendingData = {};

// --- Jadwal Pengingat Harian (Setiap jam 9 malam waktu Jakarta) ---
cron.schedule('0 21 * * *', async () => {
  console.log('Menjalankan tugas pengingat harian...');
  try {
    const res = await axios.get(`${SPREADSHEET_API}?get=users`);
    const users = res.data.users;
    if (users && users.length > 0) {
      users.forEach(chatId => {
        bot.sendMessage(chatId, '🔔 Pengingat! Jangan lupa catat transaksi keuanganmu hari ini ya!');
      });
    }
  } catch (e) {
    console.error('Gagal menjalankan tugas pengingat:', e.message);
  }
}, {
  timezone: "Asia/Jakarta"
});

// --- Perintah Bantuan ---
bot.onText(/^\/?perintah$/, (msg) => {
    const chatId = msg.chat.id;
    const helpText = `
*Daftar Perintah Bot Keuangan*

*Pencatatan Dasar:*
• \`masuk [nominal] [ket] [sumber]\`
• \`keluar [nominal] [ket] [sumber]\`
• \`tf [nominal] [dari] [ke]\`

*Utang & Piutang:*
• \`utang [nominal] [dari siapa] [ket]\`
  _(Uang masuk ke 'cash' secara default)_
• \`piutang [nominal] [ke siapa] [ket]\`
  _(Uang keluar dari 'cash' secara default)_
• \`bayar utang [ID] [nominal]\`
• \`terima piutang [ID] [nominal]\`

*Melihat Data:*
• \`saldo\` - Ringkasan saldo total & per sumber.
• \`rekap\` - Daftar semua transaksi (masuk/keluar/tf).
• \`rekap [sumber]\` - Daftar transaksi per sumber.
• \`rekap utang\` - Daftar utang yang belum lunas.
• \`rekap piutang\` - Daftar piutang yang belum lunas.

*Mengubah Data:*
(Gunakan nomor baris dari hasil \`rekap\`)
• \`hapus [no. baris]\`
• \`edit [no. baris] [nominal] [ket] [sumber]\`

*Pengingat:*
• \`/ingatkansaya\` - Mengaktifkan pengingat harian jam 9 malam.
• \`/hentikaningatkan\` - Menonaktifkan pengingat.

*Lainnya:*
• \`/lur\` - Memastikan bot aktif.
• \`/perintah\` - Daftar perintah bot keuangan.
    `;
    bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
});

// --- Perintah Pengingat ---
bot.onText(/^\/ingatkansaya$/, async (msg) => {
    try {
        await axios.post(SPREADSHEET_API, { action: 'manage_reminder', chatId: msg.chat.id, subscribe: true });
        bot.sendMessage(msg.chat.id, '✅ Oke! Pengingat harian jam 9 malam telah diaktifkan.');
    } catch (e) {
        bot.sendMessage(msg.chat.id, '❌ Gagal mengaktifkan pengingat.');
    }
});

bot.onText(/^\/hentikaningatkan$/, async (msg) => {
    try {
        await axios.post(SPREADSHEET_API, { action: 'manage_reminder', chatId: msg.chat.id, subscribe: false });
        bot.sendMessage(msg.chat.id, '✅ Siap! Pengingat harian telah dinonaktifkan.');
    } catch (e) {
        bot.sendMessage(msg.chat.id, '❌ Gagal menonaktifkan pengingat.');
    }
});


// --- Perintah Utang & Piutang ---
bot.onText(/^utang (\d+) (.+) (.+)$/i, async (msg, match) => {
    const [ , nominal, pihak, keterangan ] = match;
    const payload = { action: 'add_utang_piutang', tipe: 'Utang', nominal, pihak, keterangan };
    try {
        await axios.post(SPREADSHEET_API, payload);
        bot.sendMessage(msg.chat.id, `✅ Utang baru dari *${pihak}* sebesar Rp${parseInt(nominal).toLocaleString('id-ID')} berhasil dicatat. Saldo 'cash' bertambah.`);
        await tampilkanSaldo(msg.chat.id);
    } catch (e) {
        bot.sendMessage(msg.chat.id, '❌ Gagal mencatat utang.');
    }
});

bot.onText(/^piutang (\d+) (.+) (.+)$/i, async (msg, match) => {
    const [ , nominal, pihak, keterangan ] = match;
    const payload = { action: 'add_utang_piutang', tipe: 'Piutang', nominal, pihak, keterangan };
    try {
        await axios.post(SPREADSHEET_API, payload);
        bot.sendMessage(msg.chat.id, `✅ Piutang baru kepada *${pihak}* sebesar Rp${parseInt(nominal).toLocaleString('id-ID')} berhasil dicatat. Saldo 'cash' berkurang.`);
        await tampilkanSaldo(msg.chat.id);
    } catch (e) {
        bot.sendMessage(msg.chat.id, '❌ Gagal mencatat piutang.');
    }
});

bot.onText(/^bayar utang (\d+) (\d+)$/i, async (msg, match) => {
    const [ , id, nominal ] = match;
    const payload = { action: 'update_utang_piutang', tipe: 'bayar utang', id, nominal };
    try {
        const res = await axios.post(SPREADSHEET_API, payload);
        bot.sendMessage(msg.chat.id, `✅ Pembayaran utang (ID: ${id}) sebesar Rp${parseInt(nominal).toLocaleString('id-ID')} berhasil. ${res.data.message}`);
        await tampilkanSaldo(msg.chat.id);
    } catch (e) {
        bot.sendMessage(msg.chat.id, '❌ Gagal mencatat pembayaran utang.');
    }
});

bot.onText(/^terima piutang (\d+) (\d+)$/i, async (msg, match) => {
    const [ , id, nominal ] = match;
    const payload = { action: 'update_utang_piutang', tipe: 'terima piutang', id, nominal };
    try {
        const res = await axios.post(SPREADSHEET_API, payload);
        bot.sendMessage(msg.chat.id, `✅ Penerimaan piutang (ID: ${id}) sebesar Rp${parseInt(nominal).toLocaleString('id-ID')} berhasil. ${res.data.message}`);
        await tampilkanSaldo(msg.chat.id);
    } catch (e) {
        bot.sendMessage(msg.chat.id, '❌ Gagal mencatat penerimaan piutang.');
    }
});

// --- Rekap Utang & Piutang ---
bot.onText(/^rekap utang$/i, async (msg) => {
    try {
        const res = await axios.get(`${SPREADSHEET_API}?get=utang`);
        const items = res.data.items;
        let replyText = '📊 *Daftar Utang (Belum Lunas)*\n\n';
        if (!items || items.length === 0) {
            replyText += 'Tidak ada utang aktif.';
        } else {
            items.forEach(t => {
                replyText += `*ID: ${t.id}* | Rp${t.sisa.toLocaleString('id-ID')} kepada *${t.pihak}*\n_${t.keterangan}_\n\n`;
            });
        }
        bot.sendMessage(msg.chat.id, replyText, { parse_mode: 'Markdown' });
    } catch (e) {
        bot.sendMessage(msg.chat.id, '❌ Gagal mengambil rekap utang.');
    }
});

bot.onText(/^rekap piutang$/i, async (msg) => {
    try {
        const res = await axios.get(`${SPREADSHEET_API}?get=piutang`);
        const items = res.data.items;
        let replyText = '📊 *Daftar Piutang (Belum Lunas)*\n\n';
        if (!items || items.length === 0) {
            replyText += 'Tidak ada piutang aktif.';
        } else {
            items.forEach(t => {
                replyText += `*ID: ${t.id}* | Rp${t.sisa.toLocaleString('id-ID')} dari *${t.pihak}*\n_${t.keterangan}_\n\n`;
            });
        }
        bot.sendMessage(msg.chat.id, replyText, { parse_mode: 'Markdown' });
    } catch (e) {
        bot.sendMessage(msg.chat.id, '❌ Gagal mengambil rekap piutang.');
    }
});

// --- Kode Lama yang Disesuaikan ---
// (masuk, keluar, tf, edit, hapus, rekap, saldo, dll)
// ... (Salin sisa kode dari file Anda sebelumnya, mulai dari bot.onText(/^masuk... hingga akhir)
// Atau gunakan kode di bawah ini yang sudah lengkap.

bot.onText(/^\/lur$/, (msg) => {
  bot.sendMessage(msg.chat.id, 'Wett! 👋');
});

bot.onText(/^masuk (\d+)\s+(.+)\s+(cash|bank|ewallet)$/i, (msg, match) => {
  const chatId = msg.chat.id;
  const [ , nominal, keterangan, sumber ] = match;
  pendingData[chatId] = { action: 'add', tipe: 'masuk', nominal, keterangan, sumber };
  bot.sendMessage(chatId, '📸 Kirim foto struk jika ada, atau balas *tidak* bila tidak ada', { parse_mode: 'Markdown' });
});

bot.onText(/^keluar (\d+)\s+(.+)\s+(cash|bank|ewallet)$/i, (msg, match) => {
  const chatId = msg.chat.id;
  const [ , nominal, keterangan, sumber ] = match;
  pendingData[chatId] = { action: 'add', tipe: 'keluar', nominal, keterangan, sumber };
  bot.sendMessage(chatId, '📸 Kirim foto struk jika ada, atau balas *tidak* bila tidak ada', { parse_mode: 'Markdown' });
});

bot.onText(/^tidak$/i, async msg => {
  const chatId = msg.chat.id;
  const data = pendingData[chatId];
  if (!data || data.action !== 'add') return;
  try {
    await axios.post(SPREADSHEET_API, { ...data, action: 'add' });
    delete pendingData[chatId];
    bot.sendMessage(chatId, '✅ Transaksi berhasil dicatat.');
    await tampilkanSaldo(chatId);
  } catch (error) {
    bot.sendMessage(chatId, '❌ Gagal menyimpan data. Coba lagi.');
  }
});

bot.on('photo', async msg => {
  const chatId = msg.chat.id;
  const data = pendingData[chatId];
  if (!data || data.action !== 'add') return;
  try {
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const fileUrl = await bot.getFileLink(fileId);
    await axios.post(SPREADSHEET_API, { ...data, action: 'add', bukti: fileUrl });
    delete pendingData[chatId];
    bot.sendMessage(chatId, '✅ Transaksi dan struk berhasil dicatat.');
    await tampilkanSaldo(chatId);
  } catch (error) {
    bot.sendMessage(chatId, '❌ Gagal menyimpan data. Coba lagi.');
  }
});

bot.onText(/^tf (\d+)\s+(cash|bank|ewallet)\s+(cash|bank|ewallet)$/i, async (msg, match) => {
  const [ , nominal, sumber, tujuan ] = match;
  const data = { action: 'add', tipe: 'transfer', nominal, keterangan: `Transfer dari ${sumber} ke ${tujuan}`, sumber, tujuan };
  try {
    await axios.post(SPREADSHEET_API, data);
    bot.sendMessage(msg.chat.id, '🔁 Transfer antar dompet berhasil dicatat.');
    await tampilkanSaldo(msg.chat.id);
  } catch (error) {
    bot.sendMessage(msg.chat.id, '❌ Gagal menyimpan data transfer.');
  }
});

bot.onText(/^hapus (\d+)$/i, async (msg, match) => {
    const rowNumber = parseInt(match[1]);
    if (rowNumber < 3) {
        bot.sendMessage(msg.chat.id, "❌ Nomor baris tidak valid. Harap mulai dari baris 3.");
        return;
    }
    try {
        await axios.post(SPREADSHEET_API, { action: 'delete', rowNumber });
        bot.sendMessage(msg.chat.id, `✅ Transaksi pada baris ${rowNumber} berhasil dihapus.`);
        await tampilkanSaldo(msg.chat.id);
    } catch (error) {
        bot.sendMessage(msg.chat.id, `❌ Gagal menghapus data. Pastikan nomor baris benar.`);
    }
});

bot.onText(/^edit (\d+) (\d+) (.+) (cash|bank|ewallet)$/i, async (msg, match) => {
    const [ , rowNumber, nominal, keterangan, sumber ] = match;
    if (parseInt(rowNumber) < 3) {
        bot.sendMessage(msg.chat.id, "❌ Nomor baris tidak valid.");
        return;
    }
    try {
        await axios.post(SPREADSHEET_API, { action: 'edit', rowNumber: parseInt(rowNumber), nominal: parseInt(nominal), keterangan, sumber });
        bot.sendMessage(msg.chat.id, `✅ Transaksi pada baris ${rowNumber} berhasil diubah.`);
        await tampilkanSaldo(msg.chat.id);
    } catch (error) {
        bot.sendMessage(msg.chat.id, `❌ Gagal mengubah data. Pastikan format benar.`);
    }
});

bot.onText(/^rekap(?:\s+(cash|bank|ewallet))?$/i, async (msg, match) => {
  const sumber = match[1];
  if (match[0] === 'rekap utang' || match[0] === 'rekap piutang') return; // Hindari tumpang tindih
  try {
    let url = SPREADSHEET_API;
    if (sumber) url += `?sumber=${sumber}`;
    const res = await axios.get(url);
    const transactions = res.data.transactions;
    let replyText = sumber ? `📊 *Daftar Transaksi Sumber: ${sumber.toUpperCase()}*\n\n` : `📊 *Daftar Semua Transaksi*\n\n`;
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
    bot.sendMessage(msg.chat.id, replyText, { parse_mode: 'Markdown' });
  } catch (e) {
    bot.sendMessage(msg.chat.id, '❌ Gagal mengambil data rekap.');
  }
});

bot.onText(/^saldo$/i, async (msg) => {
  await tampilkanSaldo(msg.chat.id);
});

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
    bot.sendMessage(chatId, '❌ Gagal mengambil saldo terkini.');
  }
}

console.log('Bot catatan keuangan dengan pengingat berhasil dijalankan...');
