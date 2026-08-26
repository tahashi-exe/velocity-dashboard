import 'dotenv/config'
import { Bot, InlineKeyboard } from 'grammy'
import {
  addPhoto, createSession, currentStep, finishPhotos, goBack, openField, openMenu, promptText,
  recordFrom, recordSummary, skipStep, stepsFor, submitAnswer, thingFor, validateAll,
} from './template.js'
import { getJsonFile, updateJsonFile, uploadBinaryFile } from './github.js'
import { deleteDraft, draftsFile, loadDrafts, saveDraft } from './drafts.js'

const required = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_ADMIN_CHAT_ID', 'GITHUB_TOKEN', 'GITHUB_REPOSITORY']

for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`)
}

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN)
const adminChatId = String(process.env.TELEGRAM_ADMIN_CHAT_ID)
const branch = process.env.GITHUB_BRANCH || 'main'

// chatId -> session (see template.js). Restored from disk on boot so a restart
// mid-entry resumes instead of losing everything.
const sessions = loadDrafts()

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

// Attached photos are committed to this repo path (never overwritten — each
// gets a random id, see message:photo below) and referenced by their raw.
// githubusercontent.com URL, which is stable across GitHub Pages deploys.
function rawUrl(path) {
  return `https://raw.githubusercontent.com/${process.env.GITHUB_REPOSITORY}/${branch}/${path}`
}

function githubBase(path) {
  return { token: process.env.GITHUB_TOKEN, repository: process.env.GITHUB_REPOSITORY, branch, path }
}

async function findExisting(collection, name) {
  const file = await getJsonFile(githubBase(pathFor(collection)))
  const record = file.data.find((item) => item.name.toLowerCase() === name.toLowerCase())
  return { file, record }
}

function chatKeyOf(ctx) {
  return String(ctx.chat?.id ?? ctx.from?.id)
}

function persist(ctx, session) {
  sessions.set(chatKeyOf(ctx), session)
  saveDraft(chatKeyOf(ctx), session)
}

function forget(ctx) {
  sessions.delete(chatKeyOf(ctx))
  deleteDraft(chatKeyOf(ctx))
}

/* ---------- rendering ---------- */

function chunk(items, perRow) {
  const rows = []
  for (let i = 0; i < items.length; i += perRow) rows.push(items.slice(i, i + perRow))
  return rows
}

function stepKeyboard(session) {
  const step = currentStep(session)
  const keyboard = new InlineKeyboard()

  if (step.kind === 'choice') {
    for (const row of chunk(step.options, step.options.length > 4 ? 3 : 2)) {
      for (const option of row) keyboard.text(option.label, `ans:${option.value}`)
      keyboard.row()
    }
  } else if (step.kind === 'boolean') {
    keyboard.text('Yes', 'ans:yes').text('No', 'ans:no').row()
  }

  const nav = []
  if (session.mode === 'field') nav.push(['Back to fields', 'nav:back'])
  else if (session.stepIndex > 0) nav.push(['Back', 'nav:back'])
  if (step.key === 'photos') {
    // Photos accumulate one at a time (message:photo / message:text below),
    // so "Skip" (nothing yet) and "Done" (finalize what's there) are two
    // different actions rather than one Skip button like every other
    // optional field.
    const count = (session.answers.photos || []).length
    nav.push(count > 0 ? [`Done (${count})`, 'nav:photosdone'] : ['Skip', 'nav:skip'])
  } else if (step.optional) {
    nav.push(['Skip', 'nav:skip'])
  }
  nav.push(['Cancel', 'nav:cancel'])
  for (const [label, data] of nav) keyboard.text(label, data)

  return keyboard
}

function stepMessage(session, notice) {
  const step = currentStep(session)
  const steps = stepsFor(session.collection)
  const head = session.mode === 'field'
    ? `Editing ${step.title}`
    : `${step.title} — step ${session.stepIndex + 1} of ${steps.length}`
  const lines = []
  if (notice) lines.push(notice, '')
  lines.push(head, '', promptText(step, session.collection))
  return lines.join('\n')
}

function menuKeyboard(session) {
  const keyboard = new InlineKeyboard()
  for (const row of chunk(stepsFor(session.collection), 2)) {
    for (const step of row) keyboard.text(step.title, `field:${step.key}`)
    keyboard.row()
  }
  return keyboard.text('Review and publish', 'menu:review').row().text('Cancel', 'nav:cancel')
}

function menuMessage(session, notice) {
  const kind = thingFor(session.collection)
  const head = session.action === 'update'
    ? `Editing ${kind} "${session.matchName}"`
    : `New ${kind}`
  const problems = validateAll(session.collection, session.answers)
  const lines = []
  if (notice) lines.push(notice, '')
  lines.push(head, '', recordSummary(session.collection, session.answers), '')
  lines.push(problems.length
    ? `⚠️ Still needs fixing: ${problems.map((p) => p.title).join(', ')}`
    : 'Tap a field to change just that one, then Review and publish.')
  return lines.join('\n')
}

function previewKeyboard(session) {
  return new InlineKeyboard()
    .text('Approve and publish', `approve:${session.previewId}`).row()
    .text('Edit a field', `edit:${session.previewId}`)
    .text('Reject', `reject:${session.previewId}`)
}

function previewMessage(session, notice) {
  const target = pathFor(session.collection)
  const head = session.action === 'add'
    ? `Add new ${thingFor(session.collection)} to ${target}`
    : `Update "${session.matchName}" in ${target}`
  const lines = []
  if (notice) lines.push(notice, '')
  lines.push(head, '', recordSummary(session.collection, session.answers), '')
  lines.push('Nothing is written until you tap Approve and publish.')
  return lines.join('\n')
}

// Single entry point for showing whatever the session is currently waiting on.
async function render(ctx, session, notice) {
  persist(ctx, session)
  if (session.mode === 'walk' || session.mode === 'field') {
    return ctx.reply(stepMessage(session, notice), { reply_markup: stepKeyboard(session) })
  }
  if (session.mode === 'menu') {
    return ctx.reply(menuMessage(session, notice), { reply_markup: menuKeyboard(session) })
  }
  if (!session.previewId) session.previewId = randomId()
  persist(ctx, session)
  return ctx.reply(previewMessage(session, notice), { reply_markup: previewKeyboard(session) })
}

/* ---------- admin guard ---------- */

bot.use(async (ctx, next) => {
  if (String(ctx.chat?.id ?? ctx.from?.id) !== adminChatId) {
    if (ctx.message) await ctx.reply('This is a private Velocity admin bot.')
    return
  }
  await next()
})

/* ---------- commands ---------- */

const START_TEXT = 'Velocity admin bot is ready.\n\n'
  + '/newclub — add a recurring club\n'
  + '/newevent — add a one-off event\n'
  + '/editclub <name> — change one field on a club\n'
  + '/editevent <name> — change one field on an event\n'
  + '/listclubs, /listevents — see what exists\n'
  + '/cancel — drop whatever you were part-way through\n\n'
  + "I'll ask one question at a time, with buttons wherever there's a fixed set of answers. "
  + 'Nothing publishes until you tap Approve and publish.'

bot.command('start', (ctx) => ctx.reply(START_TEXT))

bot.command('help', (ctx) => ctx.reply(
  'How it works:\n\n'
  + '• /newclub or /newevent walks you through one question at a time. Tap buttons for '
  + 'run type, surface, freebies and day; type the rest.\n'
  + '• For the map pin: drop a Telegram location pin (paperclip → Location), paste a Google Maps '
  + 'link, or type "25.1950, 55.2358".\n'
  + '• For Photos: attach up to 3 photos right in the chat, or paste image links — either way, tap '
  + 'Done when finished.\n'
  + '• Every question has Back and Cancel. Notes and Photos also have Skip.\n'
  + '• /editclub <name> or /editevent <name> shows the record as a list of fields — tap the one '
  + 'you want to change, answer it, then Review and publish.\n'
  + '• Answers are saved as you go, so a bot restart mid-entry picks up where you left off.\n\n'
  + 'Only the Approve and publish tap writes to GitHub.',
))

bot.command('cancel', async (ctx) => {
  const had = sessions.has(chatKeyOf(ctx))
  forget(ctx)
  await ctx.reply(had ? 'Cancelled. Nothing was changed.' : 'Nothing was in progress.')
})

async function startNew(ctx, collection) {
  const replaced = sessions.has(chatKeyOf(ctx))
  const session = createSession({ collection, action: 'add' })
  await render(ctx, session, replaced ? 'Starting fresh — the previous draft was dropped.' : null)
}

bot.command('newclub', (ctx) => startNew(ctx, 'clubs'))
bot.command('newevent', (ctx) => startNew(ctx, 'events'))

// With no name argument, offer the existing records as buttons — easier than
// getting the exact spelling right on a phone.
async function offerPicker(ctx, collection) {
  const file = await getJsonFile(githubBase(pathFor(collection)))
  if (!file.data.length) return ctx.reply(`No ${collection} yet. Use /new${thingFor(collection)} to add one.`)

  const keyboard = new InlineKeyboard()
  const tooLong = []
  for (const item of file.data) {
    const data = `pick:${collection}:${item.name}`
    // Telegram caps callback_data at 64 bytes.
    if (Buffer.byteLength(data) > 64) tooLong.push(item.name)
    else keyboard.text(item.name, data).row()
  }
  const note = tooLong.length
    ? `\n\nToo long for a button — send /edit${thingFor(collection)} <name> for: ${tooLong.join(', ')}`
    : ''
  return ctx.reply(`Which ${thingFor(collection)} do you want to edit?${note}`, { reply_markup: keyboard })
}

async function startEdit(ctx, collection, name) {
  const { record } = await findExisting(collection, name)
  if (!record) return ctx.reply(`No ${thingFor(collection)} found matching "${name}". Check /list${collection} for exact names.`)
  const session = createSession({ collection, action: 'update', matchName: record.name, record })
  return render(ctx, session)
}

bot.command('editclub', async (ctx) => {
  const name = parseNameArg(ctx.match)
  if (!name) return offerPicker(ctx, 'clubs')
  return startEdit(ctx, 'clubs', name)
})

bot.command('editevent', async (ctx) => {
  const name = parseNameArg(ctx.match)
  if (!name) return offerPicker(ctx, 'events')
  return startEdit(ctx, 'events', name)
})

bot.command('listclubs', async (ctx) => {
  const file = await getJsonFile(githubBase('clubs.json'))
  if (!file.data.length) return ctx.reply('No clubs yet. /newclub adds one.')
  await ctx.reply(file.data.map((c) => `• ${c.name} — ${c.day} ${c.time}`).join('\n'))
})

bot.command('listevents', async (ctx) => {
  const file = await getJsonFile(githubBase('events.json'))
  if (!file.data.length) return ctx.reply('No events yet. /newevent adds one.')
  await ctx.reply(file.data.map((e) => `• ${e.name} — ${e.date} ${e.time}`).join('\n'))
})

/* ---------- answering ---------- */

async function handleAnswer(ctx, session, input) {
  const step = currentStep(session)
  if (step.kind === 'location' && typeof input === 'string' && /^https?:\/\//i.test(input)) {
    await ctx.replyWithChatAction('typing')
  }

  const result = await submitAnswer(session, input)
  if (result.error) {
    persist(ctx, session)
    return ctx.reply(stepMessage(session, `⚠️ ${result.error}`), { reply_markup: stepKeyboard(session) })
  }
  return render(ctx, session)
}

bot.on('message:location', async (ctx) => {
  const session = sessions.get(chatKeyOf(ctx))
  const step = session && currentStep(session)
  if (!step) {
    return ctx.reply('Thanks, but nothing is waiting on a location right now. Start with /newclub or /newevent.')
  }
  if (step.kind !== 'location') {
    return ctx.reply(`I'm on "${step.title}" right now — a pin doesn't fit here. Answer that first.`)
  }
  return handleAnswer(ctx, session, ctx.message.location)
})

// One attached photo -> the largest size Telegram sent -> downloaded via the
// Bot API's file endpoint -> staged in session.pendingUploads as base64.
// Nothing reaches GitHub yet: actual upload happens at Approve and publish
// (publishPendingUploads below), same "nothing written until you approve"
// rule every other field already follows.
bot.on('message:photo', async (ctx) => {
  const session = sessions.get(chatKeyOf(ctx))
  const step = session && currentStep(session)
  if (!step) {
    return ctx.reply('Thanks, but nothing is waiting on a photo right now. Start with /newclub or /newevent.')
  }
  if (step.key !== 'photos') {
    return ctx.reply(`I'm on "${step.title}" right now — a photo doesn't fit here. Answer that first.`)
  }
  if ((session.answers.photos || []).length >= 3) {
    return ctx.reply('Already have 3 photos — tap Done to continue, or Back to start over.')
  }

  await ctx.replyWithChatAction('upload_photo')
  const sizes = ctx.message.photo
  const largest = sizes[sizes.length - 1]
  let file
  let buffer
  try {
    file = await ctx.api.getFile(largest.file_id)
    const res = await fetch(`https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`)
    if (!res.ok) throw new Error(`download failed: ${res.status}`)
    buffer = Buffer.from(await res.arrayBuffer())
  } catch (error) {
    console.error('Could not fetch photo from Telegram:', error.message)
    return ctx.reply('Could not download that photo from Telegram — try sending it again.')
  }

  const ext = (file.file_path.split('.').pop() || 'jpg').toLowerCase()
  const repoPath = `club-photos/${randomId()}.${ext}`
  session.pendingUploads = session.pendingUploads || []
  session.pendingUploads.push({ path: repoPath, base64: buffer.toString('base64') })

  const result = addPhoto(session, rawUrl(repoPath))
  if (result.error) {
    persist(ctx, session)
    return ctx.reply(`⚠️ ${result.error}`, { reply_markup: stepKeyboard(session) })
  }
  persist(ctx, session)
  const notice = result.count >= 3
    ? `Photo ${result.count} of 3 added — that's the max.`
    : `Photo ${result.count} of 3 added. Send another, paste a link, or tap Done.`
  return ctx.reply(notice, { reply_markup: stepKeyboard(session) })
})

bot.on('message:text', async (ctx) => {
  const session = sessions.get(chatKeyOf(ctx))
  if (!session) {
    return ctx.reply('Nothing in progress. Use /newclub, /newevent, /editclub <name> or /editevent <name>.')
  }
  const step = currentStep(session)
  if (!step) {
    return ctx.reply(session.mode === 'menu'
      ? 'Tap a field above to change it, or Review and publish.'
      : 'Use the buttons on the preview above — Approve and publish, Edit a field, or Reject.')
  }

  // Photos accumulate (like attachments above) rather than replacing on
  // every message, so pasted links get their own path instead of going
  // through submitAnswer's one-shot replace.
  if (step.key === 'photos') {
    const lines = ctx.message.text.split('\n').map((s) => s.trim()).filter(Boolean)
    const bad = lines.find((line) => !/^https?:\/\//i.test(line))
    if (bad) {
      return ctx.reply(`⚠️ "${bad}" isn't a link starting with http:// or https://. Paste links, attach photos, or tap Done.`, { reply_markup: stepKeyboard(session) })
    }
    let result = { count: (session.answers.photos || []).length }
    for (const line of lines) {
      result = addPhoto(session, line)
      if (result.error) break
    }
    persist(ctx, session)
    if (result.error) return ctx.reply(`⚠️ ${result.error}`, { reply_markup: stepKeyboard(session) })
    const notice = result.count >= 3
      ? `Photo ${result.count} of 3 added — that's the max.`
      : `Photo${lines.length > 1 ? 's' : ''} added (${result.count} of 3). Send more, attach a photo, or tap Done.`
    return ctx.reply(notice, { reply_markup: stepKeyboard(session) })
  }

  return handleAnswer(ctx, session, ctx.message.text)
})

/* ---------- callbacks ---------- */

async function requireSession(ctx) {
  const session = sessions.get(chatKeyOf(ctx))
  if (!session) {
    await ctx.answerCallbackQuery({ text: 'That draft is gone. Start again with /newclub or /editclub.' })
    return null
  }
  return session
}

bot.callbackQuery(/^ans:(.+)$/, async (ctx) => {
  const session = await requireSession(ctx)
  if (!session) return
  const step = currentStep(session)
  if (!step) {
    return ctx.answerCallbackQuery({ text: 'That question has already been answered.' })
  }
  await ctx.answerCallbackQuery()
  const label = step.options?.find((o) => o.value === ctx.match[1])?.label ?? ctx.match[1]
  // Collapse the answered question into a one-line record of what was chosen.
  await ctx.editMessageText(`✓ ${step.title}: ${label}`).catch(() => {})
  await handleAnswer(ctx, session, ctx.match[1])
})

bot.callbackQuery('nav:back', async (ctx) => {
  const session = await requireSession(ctx)
  if (!session) return
  const result = goBack(session)
  if (result.error) return ctx.answerCallbackQuery({ text: result.error })
  await ctx.answerCallbackQuery()
  await ctx.editMessageReplyMarkup().catch(() => {})
  await render(ctx, session)
})

bot.callbackQuery('nav:skip', async (ctx) => {
  const session = await requireSession(ctx)
  if (!session) return
  const result = skipStep(session)
  if (result.error) return ctx.answerCallbackQuery({ text: result.error })
  await ctx.answerCallbackQuery({ text: 'Skipped.' })
  await ctx.editMessageReplyMarkup().catch(() => {})
  await render(ctx, session)
})

bot.callbackQuery('nav:photosdone', async (ctx) => {
  const session = await requireSession(ctx)
  if (!session) return
  const result = await finishPhotos(session)
  if (result.error) return ctx.answerCallbackQuery({ text: result.error })
  await ctx.answerCallbackQuery({ text: 'Photos saved.' })
  await ctx.editMessageReplyMarkup().catch(() => {})
  await render(ctx, session)
})

bot.callbackQuery('nav:cancel', async (ctx) => {
  forget(ctx)
  await ctx.answerCallbackQuery({ text: 'Cancelled.' })
  await ctx.editMessageReplyMarkup().catch(() => {})
  await ctx.reply('Cancelled. Nothing was changed.')
})

bot.callbackQuery(/^pick:(clubs|events):(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery()
  await ctx.editMessageReplyMarkup().catch(() => {})
  await startEdit(ctx, ctx.match[1], ctx.match[2])
})

bot.callbackQuery(/^field:(.+)$/, async (ctx) => {
  const session = await requireSession(ctx)
  if (!session) return
  const result = openField(session, ctx.match[1])
  if (result.error) return ctx.answerCallbackQuery({ text: result.error })
  await ctx.answerCallbackQuery()
  await ctx.editMessageReplyMarkup().catch(() => {})
  await render(ctx, session)
})

bot.callbackQuery('menu:review', async (ctx) => {
  const session = await requireSession(ctx)
  if (!session) return
  const problems = validateAll(session.collection, session.answers)
  if (problems.length) {
    await ctx.answerCallbackQuery({ text: 'Some fields still need an answer.' })
    return ctx.reply(`Fix these first:\n${problems.map((p) => `• ${p.title} — ${p.problem}`).join('\n')}`)
  }
  await ctx.answerCallbackQuery()
  await ctx.editMessageReplyMarkup().catch(() => {})
  session.mode = 'preview'
  session.stepIndex = null
  session.previewId = null
  await render(ctx, session)
})

bot.callbackQuery(/^edit:(.+)$/, async (ctx) => {
  const session = await requireSession(ctx)
  if (!session) return
  if (session.previewId !== ctx.match[1]) {
    return ctx.answerCallbackQuery({ text: 'That preview is out of date — use the newest one.' })
  }
  openMenu(session)
  await ctx.answerCallbackQuery()
  await ctx.editMessageReplyMarkup().catch(() => {})
  await render(ctx, session)
})

bot.callbackQuery(/^reject:(.+)$/, async (ctx) => {
  const session = sessions.get(chatKeyOf(ctx))
  if (session && session.previewId !== ctx.match[1]) {
    return ctx.answerCallbackQuery({ text: 'That preview is out of date — use the newest one.' })
  }
  forget(ctx)
  await ctx.answerCallbackQuery({ text: 'Rejected. Nothing was changed.' })
  await ctx.editMessageReplyMarkup().catch(() => {})
  await ctx.reply('Rejected. No files were changed.')
})

/* ---------- publishing ---------- */

// Runs right before publishSession, inside the same Approve tap. Marks each
// upload committed as it succeeds so a retry after a partial failure (e.g.
// photos land but the clubs.json write then fails) never re-PUTs a path that
// already exists on GitHub — that would 422 since uploadBinaryFile never
// passes a sha.
async function publishPendingUploads(session) {
  for (const upload of session.pendingUploads || []) {
    if (upload.committed) continue
    await uploadBinaryFile({
      token: process.env.GITHUB_TOKEN,
      repository: process.env.GITHUB_REPOSITORY,
      branch,
      path: upload.path,
      base64: upload.base64,
      message: `data: add photo ${upload.path}`,
    })
    upload.committed = true
  }
}

async function publishSession(session) {
  const path = pathFor(session.collection)
  const base = githubBase(path)
  const file = await getJsonFile(base)
  const answered = recordFrom(session.collection, session.answers)
  let next

  if (session.action === 'update') {
    const index = file.data.findIndex((item) => item.name.toLowerCase() === session.matchName.toLowerCase())
    if (index === -1) {
      throw new Error(`Could not find "${session.matchName}" in ${path} anymore. Add it fresh with /new${thingFor(session.collection)}.`)
    }
    next = [...file.data]
    // Spread the stored record first so fields the bot no longer asks about
    // (e.g. the retired `pace`) survive the edit untouched.
    next[index] = { ...file.data[index], ...answered, last_updated: todayInDubai() }
  } else {
    if (file.data.some((item) => item.name.toLowerCase() === answered.name.toLowerCase())) {
      throw new Error(`"${answered.name}" already exists in ${path}. Use /edit${thingFor(session.collection)} ${answered.name} instead.`)
    }
    next = [...file.data, { ...answered, last_updated: todayInDubai() }]
  }

  return updateJsonFile({ ...base, sha: file.sha, data: next, message: `data: ${session.action} ${answered.name}` })
}

bot.callbackQuery(/^approve:(.+)$/, async (ctx) => {
  const session = sessions.get(chatKeyOf(ctx))
  if (!session || session.mode !== 'preview' || session.previewId !== ctx.match[1]) {
    await ctx.answerCallbackQuery({ text: 'This preview has expired. Please build it again.' })
    return
  }
  try {
    await ctx.answerCallbackQuery({ text: 'Publishing…' })
    await publishPendingUploads(session)
    persist(ctx, session)
    const result = await publishSession(session)
    forget(ctx)
    await ctx.editMessageReplyMarkup().catch(() => {})
    await ctx.reply(`Published to GitHub. GitHub Pages should update in about 1–2 minutes.\n${result.commit.html_url}`)
  } catch (error) {
    persist(ctx, session)
    console.error(error)
    await ctx.reply(`${error.message}\n\nYour answers are saved — tap Approve and publish again to retry. Already-uploaded photos won't be re-sent.`)
  }
})

bot.catch((error) => console.error('Unhandled bot error:', error.error))

// Restored drafts: tell Taha what survived the restart and re-ask the question
// he was on, so a redeploy/crash never silently swallows a half-typed entry.
async function announceRestoredDraft() {
  const session = sessions.get(adminChatId)
  if (!session) return
  const what = session.action === 'update' ? `edit of "${session.matchName}"` : `new ${thingFor(session.collection)}`
  const notice = `I restarted, but your ${what} was saved — carrying on where we left off. /cancel to drop it.`
  const fakeCtx = {
    chat: { id: adminChatId },
    reply: (text, other) => bot.api.sendMessage(adminChatId, text, other),
  }
  try {
    await render(fakeCtx, session, notice)
  } catch (error) {
    console.error('Could not restore draft:', error.message)
  }
}

bot.start({
  drop_pending_updates: false,
  onStart: () => { announceRestoredDraft() },
})
console.log(`Velocity Telegram bot is running. Drafts file: ${draftsFile()}`)
