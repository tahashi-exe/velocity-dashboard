import 'dotenv/config'
import { Bot, InlineKeyboard } from 'grammy'
import { buildTemplate, parseTemplate, recordSummary } from './template.js'
import { getJsonFile, updateJsonFile } from './github.js'

const required = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_ADMIN_CHAT_ID', 'GITHUB_TOKEN', 'GITHUB_REPOSITORY']

for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`)
}

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN)
const adminChatId = String(process.env.TELEGRAM_ADMIN_CHAT_ID)
const branch = process.env.GITHUB_BRANCH || 'main'

// chatId -> { collection: 'clubs' | 'events', action: 'add' | 'update', matchName: string | null }
const awaitingTemplate = new Map()
// proposalId -> { collection, action, matchName, record }
const pending = new Map()

function todayInDubai() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

function randomId() {
  return Math.random().toString(36).slice(2, 10)
}

function parseNameArg(raw) {
  return raw?.trim().replace(/^["']|["']$/g, '').trim() || ''
}

function pathFor(collection) {
  return collection === 'clubs' ? 'clubs.json' : 'events.json'
}

function githubBase(path) {
  return { token: process.env.GITHUB_TOKEN, repository: process.env.GITHUB_REPOSITORY, branch, path }
}

async function findExisting(collection, name) {
  const file = await getJsonFile(githubBase(pathFor(collection)))
  const record = file.data.find((item) => item.name.toLowerCase() === name.toLowerCase())
  return { file, record }
}

function proposalMessage(proposal) {
  const target = pathFor(proposal.collection)
  const action = proposal.action === 'add' ? 'Add new' : `Update "${proposal.matchName}" in`
  return [`${action} ${target}`, '', recordSummary(proposal.record)].join('\n')
}

async function startTemplate(ctx, collection, action, matchName, existing) {
  awaitingTemplate.set(String(ctx.chat.id), { collection, action, matchName })
  const kind = collection === 'clubs' ? 'recurring club' : 'one-off event'
  const verb = action === 'add' ? 'Fill in every line below' : 'Edit whatever changed, keep the rest as-is'
  const template = buildTemplate(collection, existing || null)
  await ctx.reply(
    `${action === 'add' ? 'New' : 'Editing'} ${kind}${action === 'update' ? ` — "${matchName}"` : ''}\n` +
    `${verb}, then send it back as one message.\n\n${template}`,
  )
}

bot.use(async (ctx, next) => {
  if (String(ctx.chat?.id) !== adminChatId) {
    if (ctx.message) await ctx.reply('This is a private Velocity admin bot.')
    return
  }
  await next()
})

bot.command('start', (ctx) => ctx.reply(
  'Velocity admin bot is ready.\n\n' +
  '/newclub — add a recurring club\n' +
  '/editclub <exact name> — edit an existing club\n' +
  '/newevent — add a one-off event\n' +
  '/editevent <exact name> — edit an existing event\n' +
  '/listclubs, /listevents — see what exists\n' +
  '/cancel — cancel whatever you were filling in\n\n' +
  "I'll send you a template to fill in and reply with. Nothing publishes until you press Approve.",
))

bot.command('help', (ctx) => ctx.reply(
  'Use /newclub or /newevent for a blank template, or /editclub <name> / /editevent <name> ' +
  'to get one pre-filled with the existing record. Edit the values after each "key:", send the ' +
  'whole message back, then press Approve and publish on the preview.',
))

bot.command('cancel', async (ctx) => {
  awaitingTemplate.delete(String(ctx.chat.id))
  await ctx.reply('Cancelled. Nothing was changed.')
})

bot.command('newclub', (ctx) => startTemplate(ctx, 'clubs', 'add', null, null))
bot.command('newevent', (ctx) => startTemplate(ctx, 'events', 'add', null, null))

bot.command('editclub', async (ctx) => {
  const name = parseNameArg(ctx.match)
  if (!name) return ctx.reply('Usage: /editclub <exact club name> (no quotes needed) — see /listclubs for the exact names.')
  const { record } = await findExisting('clubs', name)
  if (!record) return ctx.reply(`No club found matching "${name}". Check /listclubs for exact names.`)
  await startTemplate(ctx, 'clubs', 'update', record.name, record)
})

bot.command('editevent', async (ctx) => {
  const name = parseNameArg(ctx.match)
  if (!name) return ctx.reply('Usage: /editevent <exact event name> (no quotes needed) — see /listevents for the exact names.')
  const { record } = await findExisting('events', name)
  if (!record) return ctx.reply(`No event found matching "${name}". Check /listevents for exact names.`)
  await startTemplate(ctx, 'events', 'update', record.name, record)
})

bot.command('listclubs', async (ctx) => {
  const file = await getJsonFile(githubBase('clubs.json'))
  if (!file.data.length) return ctx.reply('No clubs yet.')
  await ctx.reply(file.data.map((c) => `• ${c.name} — ${c.day} ${c.time}`).join('\n'))
})

bot.command('listevents', async (ctx) => {
  const file = await getJsonFile(githubBase('events.json'))
  if (!file.data.length) return ctx.reply('No events yet.')
  await ctx.reply(file.data.map((e) => `• ${e.name} — ${e.date} ${e.time}`).join('\n'))
})

bot.on('message:text', async (ctx) => {
  const chatKey = String(ctx.chat.id)
  const awaiting = awaitingTemplate.get(chatKey)
  if (!awaiting) {
    await ctx.reply('Use /newclub, /editclub <name>, /newevent, or /editevent <name> to get started.')
    return
  }

  if (/maps_link:\s*https?:\/\//i.test(ctx.message.text)) await ctx.replyWithChatAction('typing')
  const { record, errors } = await parseTemplate(awaiting.collection, ctx.message.text)
  if (errors.length) {
    await ctx.reply(`Fix these and send the full template again:\n\n${errors.map((e) => `• ${e}`).join('\n')}`)
    return
  }

  awaitingTemplate.delete(chatKey)
  const proposal = { collection: awaiting.collection, action: awaiting.action, matchName: awaiting.matchName, record }
  const id = randomId()
  pending.set(id, proposal)
  const keyboard = new InlineKeyboard().text('Approve and publish', `approve:${id}`).text('Reject', `reject:${id}`)
  await ctx.reply(proposalMessage(proposal), { reply_markup: keyboard })
})

async function publishProposal(proposal) {
  const path = pathFor(proposal.collection)
  const base = githubBase(path)
  const file = await getJsonFile(base)
  const record = { ...proposal.record, last_updated: todayInDubai() }
  let next

  if (proposal.action === 'update') {
    const index = file.data.findIndex((item) => item.name.toLowerCase() === proposal.matchName.toLowerCase())
    if (index === -1) throw new Error(`Could not find "${proposal.matchName}" in ${path} anymore. Resend it as /new${proposal.collection.slice(0, -1)}.`)
    next = [...file.data]
    next[index] = record
  } else {
    if (file.data.some((item) => item.name.toLowerCase() === record.name.toLowerCase())) {
      throw new Error(`"${record.name}" already exists in ${path}. Use /edit${proposal.collection.slice(0, -1)} ${record.name} instead.`)
    }
    next = [...file.data, record]
  }

  return updateJsonFile({ ...base, sha: file.sha, data: next, message: `data: ${proposal.action} ${record.name}` })
}

bot.callbackQuery(/^reject:(.+)$/, async (ctx) => {
  pending.delete(ctx.match[1])
  await ctx.answerCallbackQuery({ text: 'Rejected. Nothing was changed.' })
  await ctx.editMessageReplyMarkup()
  await ctx.reply('Rejected. No files were changed.')
})

bot.callbackQuery(/^approve:(.+)$/, async (ctx) => {
  const proposal = pending.get(ctx.match[1])
  if (!proposal) {
    await ctx.answerCallbackQuery({ text: 'This proposal has expired. Please resend it.' })
    return
  }
  try {
    await ctx.answerCallbackQuery({ text: 'Publishing…' })
    const result = await publishProposal(proposal)
    pending.delete(ctx.match[1])
    await ctx.editMessageReplyMarkup()
    await ctx.reply(`Published to GitHub. GitHub Pages should update in about 1–2 minutes.\n${result.commit.html_url}`)
  } catch (error) {
    console.error(error)
    await ctx.reply(`Nothing was changed: ${error.message}`)
  }
})

bot.catch((error) => console.error('Unhandled bot error:', error.error))
bot.start({ drop_pending_updates: false })
console.log('Velocity Telegram bot is running.')
