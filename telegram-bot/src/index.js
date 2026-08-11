import 'dotenv/config'
import { Bot, InlineKeyboard } from 'grammy'
import { extractProposal } from './extract.js'
import { getJsonFile, updateJsonFile } from './github.js'

const required = [
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_ADMIN_CHAT_ID',
  'GITHUB_TOKEN',
  'GITHUB_REPOSITORY',
  'OPENAI_API_KEY',
]

for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`)
}

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN)
const adminChatId = String(process.env.TELEGRAM_ADMIN_CHAT_ID)
const branch = process.env.GITHUB_BRANCH || 'main'
const pending = new Map()

function todayInDubai() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

function isValidRecord(proposal) {
  const { collection, record } = proposal
  const common = ['name', 'location_name', 'lat', 'lng', 'pace', 'type', 'surface', 'freebies', 'time', 'link']
  const schedule = collection === 'clubs' ? ['day'] : ['date']
  const missing = [...common, ...schedule].filter((field) => record[field] === null || record[field] === '')
  if (!Number.isFinite(record.lat) || !Number.isFinite(record.lng)) {
    if (!missing.includes('lat')) missing.push('lat')
    if (!missing.includes('lng')) missing.push('lng')
  }
  return missing
}

function proposalMessage(proposal) {
  const target = proposal.collection === 'clubs' ? 'clubs.json' : 'events.json'
  return [
    `Proposed ${proposal.action} to ${target}`,
    proposal.summary,
    '',
    proposal.record_summary,
  ].join('\n')
}

function randomId() {
  return Math.random().toString(36).slice(2, 10)
}

async function getImageDataUrl(ctx) {
  const photo = ctx.message?.photo?.at(-1)
  if (!photo) return null
  const file = await bot.api.getFile(photo.file_id)
  if (!file.file_path) throw new Error('Telegram did not return an image path.')
  const url = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`
  const response = await fetch(url)
  if (!response.ok) throw new Error('Could not download the Telegram image.')
  const bytes = Buffer.from(await response.arrayBuffer())
  return `data:image/jpeg;base64,${bytes.toString('base64')}`
}

async function loadData() {
  const base = { token: process.env.GITHUB_TOKEN, repository: process.env.GITHUB_REPOSITORY, branch }
  const [clubs, events] = await Promise.all([
    getJsonFile({ ...base, path: 'clubs.json' }),
    getJsonFile({ ...base, path: 'events.json' }),
  ])
  return { clubs, events }
}

async function handleSubmission(ctx) {
  const text = ctx.message?.text || ctx.message?.caption || ctx.message?.forward_origin?.type || ''
  const imageDataUrl = await getImageDataUrl(ctx)
  if (!text && !imageDataUrl) {
    await ctx.reply('Send text, forward a text post, or send a screenshot with a caption.')
    return
  }

  await ctx.reply('Analysing your submission…')
  const { clubs, events } = await loadData()
  const proposal = await extractProposal({ text, imageDataUrl, clubs: clubs.data, events: events.data })
  const invalidFields = isValidRecord(proposal)

  if (invalidFields.length) {
    await ctx.reply(
      `${proposal.summary}\n\nI need: ${invalidFields.join(', ')}.\n` +
      'Please send the missing details (a Google Maps link is ideal for coordinates), then resend the update.',
    )
    return
  }

  const id = randomId()
  pending.set(id, proposal)
  const keyboard = new InlineKeyboard()
    .text('Approve and publish', `approve:${id}`)
    .text('Reject', `reject:${id}`)
  await ctx.reply(proposalMessage(proposal), { reply_markup: keyboard })
}

async function publishProposal(proposal) {
  const path = proposal.collection === 'clubs' ? 'clubs.json' : 'events.json'
  const base = { token: process.env.GITHUB_TOKEN, repository: process.env.GITHUB_REPOSITORY, branch, path }
  const file = await getJsonFile(base)
  const record = { ...proposal.record, last_updated: todayInDubai() }
  let next

  if (proposal.action === 'update') {
    const index = file.data.findIndex((item) => item.name === proposal.match_name)
    if (index === -1) throw new Error(`Could not find “${proposal.match_name}” in ${path}. Resubmit it as a new proposal.`)
    next = [...file.data]
    next[index] = record
  } else {
    if (file.data.some((item) => item.name.toLowerCase() === record.name.toLowerCase())) {
      throw new Error(`“${record.name}” already exists in ${path}. Resubmit this as an update.`)
    }
    next = [...file.data, record]
  }

  return updateJsonFile({
    ...base,
    sha: file.sha,
    data: next,
    message: `data: ${proposal.action} ${record.name}`,
  })
}

bot.use(async (ctx, next) => {
  if (String(ctx.chat?.id) !== adminChatId) {
    if (ctx.message) await ctx.reply('This is a private Velocity admin bot.')
    return
  }
  await next()
})

bot.command('start', (ctx) => ctx.reply(
  'Velocity admin bot is ready. Send or forward a club/event update, or send a screenshot with a caption. I will prepare a preview for your approval.',
))

bot.command('help', (ctx) => ctx.reply(
  'Send a text update, forwarded announcement, or screenshot. Include the club/event, day/date, time, meetup location, link, and ideally a Google Maps link. I will not publish anything until you press Approve and publish.',
))

bot.on(['message:text', 'message:photo'], async (ctx) => {
  try {
    await handleSubmission(ctx)
  } catch (error) {
    console.error(error)
    await ctx.reply(`I could not prepare that update: ${error.message}`)
  }
})

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
