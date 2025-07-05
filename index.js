require('dotenv').config();
const fs = require('fs');
const { Telegraf } = require('telegraf');
const { google } = require('googleapis');

const bot = new Telegraf(process.env.BOT_TOKEN);

function getAuthWithFallback() {
  const keyFiles = ['cred-1.json', 'cred-2.json'];
  for (const file of keyFiles) {
    try {
      if (fs.existsSync(file)) {
        console.log(`✅ Using credentials from: ${file}`);
        return new google.auth.GoogleAuth({
          keyFile: file,
          scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
      }
    } catch (err) {
      console.error(`Error checking ${file}:`, err);
    }
  }
  throw new Error('❌ No valid credential files found');
}

const auth = getAuthWithFallback();
const sheets = google.sheets({ version: 'v4', auth });
const userStates = {};

async function isUserInGroup(userId) {
  try {
    const member = await bot.telegram.getChatMember(process.env.GROUP_ID, userId);
    const status = member?.status;
    return ['member', 'administrator', 'creator'].includes(status);
  } catch (err) {
    return false;
  }
}

bot.start(async (ctx) => {
  if (ctx.chat.type !== 'private') return;

  const isMember = await isUserInGroup(ctx.from.id);
  if (isMember) {
    ctx.reply('✅ You are already a member of the IndieKaum Hub group!');
    return;
  }

  userStates[ctx.chat.id] = { step: 'welcome' };

  // First message
  ctx.reply(`🎙️ Welcome to IndieKaum –

Before we unlock full access, we need to know who’s in the room.

📌 Why?  
To keep this space authentic, trusted, and spam-free.

🛡️ Your data stays safe, encrypted, and never shared.

📥 Fill your quick intro here  
It takes 45 seconds.  Let’s keep IndieKaum real.`);

  // Delay 5 seconds and send first input
  setTimeout(() => {
    userStates[ctx.chat.id].step = 'name';
    ctx.reply('📝 Your Full Name:', {
      reply_markup: { remove_keyboard: true }
    });
  }, 5000);
});

bot.command('restart', async (ctx) => {
  if (ctx.chat.type !== 'private') return;

  const isMember = await isUserInGroup(ctx.from.id);
  if (isMember) {
    ctx.reply('✅ You are already verified. Please join using the link sent above or type /restart to start again.');
    return;
  }

  userStates[ctx.chat.id] = { step: 'welcome' };

  ctx.reply(`🎙️ Restarting... Please wait...`);

  setTimeout(() => {
    userStates[ctx.chat.id].step = 'name';
    ctx.reply('📝 Your Full Name:', {
      reply_markup: { remove_keyboard: true }
    });
  }, 5000);
});

bot.hears('Next', (ctx) => {
  if (ctx.chat.type !== 'private') return;
  const state = userStates[ctx.chat.id] || {};

  if (state.step === 'invite_message') {
    state.step = 'show_join';
    showJoinMessage(ctx);
  }

  userStates[ctx.chat.id] = state;
});

async function showJoinMessage(ctx) {
  try {
    const groupId = process.env.GROUP_ID;
    const invite = await bot.telegram.createChatInviteLink(groupId, {
      member_limit: 1,
      expire_date: Math.floor(Date.now() / 1000) + (10 * 60)
    });

    await ctx.reply(`✅ Thanks! You're now verified.

📵 Optional: If you wish to hide your contact number from other members, follow:  
Settings > Privacy and Security > Phone Number > Nobody`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '🚀 Join IndieKaum Hub', url: invite.invite_link }
        ]]
      }
    });
  } catch (error) {
    console.error('Invite error:', error);
    ctx.reply('❌ Error generating group invite.');
  }
}

bot.on('text', async (ctx) => {
  if (ctx.chat.type !== 'private') return;
  const state = userStates[ctx.chat.id];
  if (!state) return ctx.reply('Please type /start to begin.');

  if (['welcome', 'invite_message', 'show_join'].includes(state.step)) return;

  const input = ctx.message.text.trim();

  switch (state.step) {
    case 'name':
      state.name = input;
      state.step = 'role';
      ctx.reply('🎭 Your Creative Role (e.g. Writer, Editor, Designer, etc.):');
      break;

    case 'role':
      state.role = input;
      state.step = 'city';
      ctx.reply('🌍 Your City:');
      break;

    case 'city':
      state.city = input;
      state.step = 'phone';
      ctx.reply('📞 Phone Number (10 digits):');
      break;

    case 'phone':
      if (!/^[0-9]{10}$/.test(input)) return ctx.reply('❗ Invalid phone number.');
      state.phone = input;
      state.step = 'email';
      ctx.reply('📇 Email Address:');
      break;

    case 'email':
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input)) return ctx.reply('❗ Invalid email.');
      state.email = input;

      try {
        const authClient = await auth.getClient();
        await sheets.spreadsheets.values.append({
          spreadsheetId: process.env.SHEET_ID,
          range: 'Sheet1!A1',
          valueInputOption: 'USER_ENTERED',
          resource: {
            values: [[
              state.name,
              state.role,
              state.city,
              state.phone,
              state.email,
            ]],
          },
          auth: authClient,
        });

        state.step = 'invite_message';

        ctx.reply(`You just stepped into a signal-only zone for serious creators.
🎯 Gigs. 🎬 Collabs. 🎤 Real Work.

Let’s grow this tribe, one authentic creator at a time.  

*Press ‘NEXT’ button to proceed!*`, {
          parse_mode: 'Markdown',
          reply_markup: {
            keyboard: [['Next']],
            resize_keyboard: true,
            one_time_keyboard: true,
            input_field_placeholder: 'Tap Next to continue'
          }
        });

      } catch (err) {
        console.error('Spreadsheet error:', err);
        ctx.reply('❌ Could not save your data.');
      }
      break;

    default:
      ctx.reply('Please type /start to begin.');
  }

  userStates[ctx.chat.id] = state;
});

bot.on('message', async (ctx) => {
  const msg = ctx.message;

  if (msg.new_chat_members || msg.left_chat_member || (msg.text && msg.text.toLowerCase().includes('you joined this group'))) {
    try {
      await ctx.deleteMessage(msg.message_id);
    } catch (err) {
      console.error('❌ Could not delete join/leave message:', err);
    }
  }
});

bot.launch();
console.log('🤖 Bot is running...');
