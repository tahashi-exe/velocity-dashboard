/* The bot itself: every command, message handler and button.

   It knows nothing about how updates arrive or where drafts are kept, so the
   same code runs in both homes:
   - edge.ts   Supabase Edge Function. Telegram calls it by webhook; drafts
               live in the `bot_sessions` table. This is where it runs.
   - index.js  Node, long polling, drafts in a local file. For running it on
               your own machine.

   grammy is passed in rather than imported, because Node resolves it from
   node_modules and Deno from an npm: specifier. Nothing here uses a Node-only
   API (no Buffer, fs or process), for the same reason. */

import {
  addPhoto, applyForm, backToForm, buildForm, createSession, finishPhotos, parseForm,
  recordFrom, recordSummary, thingFor, validateAll,
} from './template.js'
import { getJsonFile, toBase64, updateJsonFile, uploadBinaryFile } from './github.js'
import { kindFor, slugOf, toRunRow } from './run-row.js'
import { saveRun } from './supabase.js'

export const REQUIRED_ENV = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_ADMIN_CHAT_ID', 'GITHUB_TOKEN', 'GITHUB_REPOSITORY']

// env:      the REQUIRED_ENV values, plus optional GITHUB_BRANCH
// database: { url, key } to mirror publishes into `runs`, or null to skip
// store:    async { get(chatId), set(chatId, session), delete(chatId) }
export function createBot({ grammy, env, database = null, store, fetchImpl = fetch }) {
  const { Bot, InlineKeyboard } = grammy
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN)
  const adminChatId = String(env.TELEGRAM_ADMIN_CHAT_ID)
  const branch = env.GITHUB_BRANCH || 'main'

  // chatId -> session (see template.js). A per-update working copy: the
  // session middleware below fills it from the store before the handlers run
  // and writes it back after.
  const sessions = new Map()

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
    return `https://raw.githubusercontent.com/${env.GITHUB_REPOSITORY}/${branch}/${path}`
  }

  function githubBase(path) {
    return { token: env.GITHUB_TOKEN, repository: env.GITHUB_REPOSITORY, branch, path, fetchImpl }
  }

  async function findExisting(collection, name) {
    const file = await getJsonFile(githubBase(pathFor(collection)))
    const record = file.data.find((item) => item.name.toLowerCase() === name.toLowerCase())
    return { file, record }
  }

  function chatKeyOf(ctx) {
    return String(ctx.chat?.id ?? ctx.from?.id)
  }

  // Both only touch the working copy; the session middleware saves it once
  // the handler is done. checkpoint() is for the moments that can't wait.
  function persist(ctx, session) {
    sessions.set(chatKeyOf(ctx), session)
  }

  function forget(ctx) {
    sessions.delete(chatKeyOf(ctx))
  }

  // Saves right now rather than at the end of the update. Used around the
  // publish steps, so that if the process is cut off mid-way the draft still
  // records what has already been written and a retry doesn't write it twice.
  async function checkpoint(ctx, session) {
    persist(ctx, session)
    await store.set(chatKeyOf(ctx), session)
  }

  /* ---------- rendering ---------- */

  // The form block goes inside <pre>, which most Telegram clients render with a
  // tap-to-copy affordance — the whole point of a paste-back flow. HTML parse
  // mode (not Markdown) because club links and values like "long_run" are full
  // of underscores that Markdown chokes on.
  function escapeHtml(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  function formMessage(session, notice) {
    const kind = thingFor(session.collection)
    const editing = session.action === 'update'
    const head = editing ? `Editing ${kind} "${session.matchName}"` : `New ${kind}`
    const intro = editing
      ? 'Current values are filled in. Change what you need, leave the rest alone, and send the whole block back as one message.'
      : 'Replace the value after each colon, then send the whole block back as one message.'
    const lines = []
    if (notice) lines.push(escapeHtml(notice), '')
    lines.push(escapeHtml(head), '', escapeHtml(intro), '')
    lines.push(`<pre>${escapeHtml(buildForm(session.collection, session.answers))}</pre>`)
    lines.push('', escapeHtml('Photos come after this — they have to be sent as attachments, so they are not in the block.'))
    return lines.join('\n')
  }

  function formKeyboard() {
    return new InlineKeyboard().text('Cancel', 'nav:cancel')
  }

  function photosMessage(session, notice) {
    const count = (session.answers.photos || []).length
    const lines = []
    if (notice) lines.push(notice, '')
    lines.push('Photos', '', 'Attach up to 3 photos here, or paste direct image links one per line.')
    lines.push('', count ? `${count} added so far — tap Done when you're finished.` : 'Tap Skip if there are none.')
    return lines.join('\n')
  }

  function photosKeyboard(session) {
    const count = (session.answers.photos || []).length
    return new InlineKeyboard()
      .text(count > 0 ? `Done (${count})` : 'Skip — no photos', 'nav:photosdone').row()
      .text('Back to the form', 'nav:back')
      .text('Cancel', 'nav:cancel')
  }

  function previewKeyboard(session) {
    return new InlineKeyboard()
      .text('Approve and publish', `approve:${session.previewId}`).row()
      .text('Edit the form', `edit:${session.previewId}`)
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
    // A draft picked up again later can be past the commit already.
    lines.push(session.published
      ? 'This is already on GitHub. Only the database write is left — tap Approve and publish to retry it.'
      : 'Nothing is written until you tap Approve and publish.')
    return lines.join('\n')
  }

  // Single entry point for showing whatever the session is currently waiting on.
  async function render(ctx, session, notice) {
    persist(ctx, session)
    if (session.mode === 'form') {
      return ctx.reply(formMessage(session, notice), { parse_mode: 'HTML', reply_markup: formKeyboard() })
    }
    if (session.mode === 'photos') {
      return ctx.reply(photosMessage(session, notice), { reply_markup: photosKeyboard(session) })
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

  /* ---------- session load / save ----------
     Every update starts from what the store holds and ends by writing back
     whatever the handlers left, so nothing depends on the process still being
     alive between two messages. That is what lets this run as an Edge
     Function, where each update may land on a fresh instance. */

  bot.use(async (ctx, next) => {
    const key = chatKeyOf(ctx)
    const stored = await store.get(key)
    if (stored) sessions.set(key, stored)
    else sessions.delete(key)
    try {
      await next()
    } finally {
      const current = sessions.get(key)
      if (current) await store.set(key, current)
      else if (stored) await store.delete(key)
      sessions.delete(key)
    }
  })

  /* ---------- commands ---------- */

  const START_TEXT = 'Velocity admin bot is ready.\n\n'
    + '/newclub — add a recurring club\n'
    + '/newevent — add a one-off event\n'
    + '/editclub <name> — change one field on a club\n'
    + '/editevent <name> — change one field on an event\n'
    + '/listclubs, /listevents — see what exists\n'
    + '/cancel — drop whatever you were part-way through\n\n'
    + 'I send one block with every field in it. You fill it in, send it back in one message, '
    + 'then add photos. Nothing publishes until you tap Approve and publish.'

  bot.command('start', (ctx) => ctx.reply(START_TEXT))

  bot.command('help', (ctx) => ctx.reply(
    'How it works:\n\n'
    + '• /newclub or /newevent sends one block with every field. Tap it to copy, replace the value '
    + 'after each colon, and send the whole thing back as one message.\n'
    + '• Leave an optional line on its placeholder text (like "optional") and it counts as blank.\n'
    + '• For the location line: paste a Google Maps link or type "25.1950, 55.2358". You can also '
    + 'drop a Telegram pin (paperclip → Location) and I\'ll reply with the coordinates to paste in.\n'
    + '• Anything wrong comes back as one list, so you fix it all in a single resend.\n'
    + '• Photos come right after the block — attach up to 3, or paste image links, then tap Done. '
    + 'They have to be their own message, which is why they are not in the block.\n'
    + '• /editclub <name> or /editevent <name> sends the same block pre-filled with what is already '
    + 'stored — change what you need and send it back.\n'
    + '• Drafts are saved, so you can come back to a half-finished entry later.\n\n'
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
      if (new TextEncoder().encode(data).length > 64) tooLong.push(item.name)
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

  // A dropped pin can't be typed into a pasted block, so it doesn't answer the
  // location line directly — the coordinates come back as copyable text instead.
  bot.on('message:location', async (ctx) => {
    const { latitude, longitude } = ctx.message.location
    const coords = `${Math.round(latitude * 1e6) / 1e6}, ${Math.round(longitude * 1e6) / 1e6}`
    const session = sessions.get(chatKeyOf(ctx))
    if (!session || session.mode !== 'form') {
      return ctx.reply(`Pin received: ${coords}`)
    }
    return ctx.reply(`Pin received. Paste this into the "location:" line:\n\n${coords}`)
  })

  // One attached photo -> the largest size Telegram sent -> remembered on the
  // session by its Telegram file id. Nothing reaches GitHub yet: the download
  // and upload happen at Approve and publish (publishPendingUploads below),
  // the same "nothing written until you approve" rule every other field
  // follows. Keeping the id rather than the image keeps drafts small.
  bot.on('message:photo', async (ctx) => {
    const session = sessions.get(chatKeyOf(ctx))
    if (!session) {
      return ctx.reply('Thanks, but nothing is waiting on a photo right now. Start with /newclub or /newevent.')
    }
    if (session.mode !== 'photos') {
      return ctx.reply(session.mode === 'form'
        ? "I'm waiting on the filled-in block first — photos come straight after it."
        : 'Photos are already done for this one. Use the buttons on the preview above.')
    }
    if ((session.answers.photos || []).length >= 3) {
      return ctx.reply('Already have 3 photos — tap Done to continue.')
    }

    await ctx.replyWithChatAction('upload_photo')
    const sizes = ctx.message.photo
    const largest = sizes[sizes.length - 1]
    let file
    try {
      // Asked for now, although the bytes are fetched later: it confirms
      // Telegram still has the photo and gives the file extension.
      file = await ctx.api.getFile(largest.file_id)
    } catch (error) {
      console.error('Could not look up photo on Telegram:', error.message)
      return ctx.reply('Could not read that photo from Telegram — try sending it again.')
    }

    const ext = (file.file_path.split('.').pop() || 'jpg').toLowerCase()
    const repoPath = `club-photos/${randomId()}.${ext}`
    session.pendingUploads = session.pendingUploads || []
    session.pendingUploads.push({ path: repoPath, fileId: largest.file_id })

    const result = addPhoto(session, rawUrl(repoPath))
    if (result.error) {
      session.pendingUploads.pop()
      persist(ctx, session)
      return ctx.reply(`⚠️ ${result.error}`, { reply_markup: photosKeyboard(session) })
    }
    persist(ctx, session)
    const notice = result.count >= 3
      ? `Photo ${result.count} of 3 added — that's the max.`
      : `Photo ${result.count} of 3 added. Send another, paste a link, or tap Done.`
    return ctx.reply(notice, { reply_markup: photosKeyboard(session) })
  })

  bot.on('message:text', async (ctx) => {
    const session = sessions.get(chatKeyOf(ctx))
    if (!session) {
      return ctx.reply('Nothing in progress. Use /newclub, /newevent, /editclub <name> or /editevent <name>.')
    }

    // The whole record arrives in one message. Every problem is reported at
    // once rather than one per resend.
    if (session.mode === 'form') {
      await ctx.replyWithChatAction('typing')
      const { answers, errors } = await parseForm(session.collection, ctx.message.text)
      if (errors.length) {
        persist(ctx, session)
        return ctx.reply(
          `Nothing published. Fix these and send the whole block again:\n\n${errors.map((e) => `• ${e}`).join('\n')}`,
          { reply_markup: formKeyboard() },
        )
      }
      applyForm(session, answers)
      return render(ctx, session, 'Every field checks out.')
    }

    // Photos accumulate rather than replacing, so pasted links append.
    if (session.mode === 'photos') {
      const lines = ctx.message.text.split('\n').map((s) => s.trim()).filter(Boolean)
      const bad = lines.find((line) => !/^https?:\/\//i.test(line))
      if (bad) {
        return ctx.reply(`⚠️ "${bad}" isn't a link starting with http:// or https://. Paste links, attach photos, or tap Done.`, { reply_markup: photosKeyboard(session) })
      }
      let result = { count: (session.answers.photos || []).length }
      for (const line of lines) {
        result = addPhoto(session, line)
        if (result.error) break
      }
      persist(ctx, session)
      if (result.error) return ctx.reply(`⚠️ ${result.error}`, { reply_markup: photosKeyboard(session) })
      const notice = result.count >= 3
        ? `Photo ${result.count} of 3 added — that's the max.`
        : `Photo${lines.length > 1 ? 's' : ''} added (${result.count} of 3). Send more, attach a photo, or tap Done.`
      return ctx.reply(notice, { reply_markup: photosKeyboard(session) })
    }

    return ctx.reply('Use the buttons on the preview above — Approve and publish, Edit the form, or Reject.')
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

  bot.callbackQuery('nav:back', async (ctx) => {
    const session = await requireSession(ctx)
    if (!session) return
    backToForm(session)
    await ctx.answerCallbackQuery()
    await ctx.editMessageReplyMarkup().catch(() => {})
    await render(ctx, session)
  })

  bot.callbackQuery('nav:photosdone', async (ctx) => {
    const session = await requireSession(ctx)
    if (!session) return
    const result = finishPhotos(session)
    if (result.error) return ctx.answerCallbackQuery({ text: result.error })

    // Last line of defence: an edit loaded from an older record can carry values
    // the form no longer accepts (e.g. the retired type "track"), and those never
    // pass through parseForm. Catch them here rather than at publish.
    const problems = validateAll(session.collection, session.answers)
    if (problems.length) {
      backToForm(session)
      await ctx.answerCallbackQuery({ text: 'Some fields still need fixing.' })
      await ctx.editMessageReplyMarkup().catch(() => {})
      return render(ctx, session, `Still needs fixing: ${problems.map((p) => `${p.title} (${p.problem})`).join(', ')}`)
    }

    await ctx.answerCallbackQuery({ text: 'Saved.' })
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

  bot.callbackQuery(/^edit:(.+)$/, async (ctx) => {
    const session = await requireSession(ctx)
    if (!session) return
    if (session.previewId !== ctx.match[1]) {
      return ctx.answerCallbackQuery({ text: 'That preview is out of date — use the newest one.' })
    }
    // Once the GitHub commit is in, the answers can't change underneath it: the
    // only thing left to retry is the database write.
    if (session.published) {
      return ctx.answerCallbackQuery({ text: 'Already published to GitHub — only the database write is left.' })
    }
    backToForm(session)
    await ctx.answerCallbackQuery()
    await ctx.editMessageReplyMarkup().catch(() => {})
    await render(ctx, session)
  })

  bot.callbackQuery(/^reject:(.+)$/, async (ctx) => {
    const session = sessions.get(chatKeyOf(ctx))
    if (session && session.previewId !== ctx.match[1]) {
      return ctx.answerCallbackQuery({ text: 'That preview is out of date — use the newest one.' })
    }
    const halfPublished = Boolean(session?.published)
    forget(ctx)
    await ctx.editMessageReplyMarkup().catch(() => {})
    if (halfPublished) {
      // The commit already happened, so "nothing was changed" would be untrue.
      await ctx.answerCallbackQuery({ text: 'Left as it is.' })
      await ctx.reply('Left as it is: the site files on GitHub are updated, the database is not. '
        + `Edit and approve "${session.published.name}" again whenever you want to bring the database in line.`)
      return
    }
    await ctx.answerCallbackQuery({ text: 'Rejected. Nothing was changed.' })
    await ctx.reply('Rejected. No files were changed.')
  })

  /* ---------- publishing ---------- */

  async function downloadPhoto(api, fileId) {
    const file = await api.getFile(fileId)
    const response = await fetchImpl(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`)
    if (!response.ok) throw new Error(`Could not download a photo from Telegram: ${response.status}`)
    return toBase64(new Uint8Array(await response.arrayBuffer()))
  }

  // Runs right before publishSession, inside the same Approve tap. Marks each
  // upload committed as it succeeds so a retry after a partial failure (e.g.
  // photos land but the clubs.json write then fails) never re-PUTs a path that
  // already exists on GitHub — that would 422 since uploadBinaryFile never
  // passes a sha.
  async function publishPendingUploads(ctx, session) {
    for (const upload of session.pendingUploads || []) {
      if (upload.committed) continue
      // Drafts saved by an older version carried the image itself.
      const base64 = upload.base64 || await downloadPhoto(ctx.api, upload.fileId)
      await uploadBinaryFile({
        ...githubBase(upload.path),
        base64,
        message: `data: add photo ${upload.path}`,
      })
      upload.committed = true
      delete upload.base64
      await checkpoint(ctx, session)
    }
  }

  async function publishSession(session) {
    const path = pathFor(session.collection)
    const base = githubBase(path)
    const file = await getJsonFile(base)
    const answered = recordFrom(session.collection, session.answers)
    let next
    // The record exactly as it will stand in the file, which is what the
    // database row has to match (an edit keeps fields the form didn't touch).
    let record

    if (session.action === 'update') {
      const index = file.data.findIndex((item) => item.name.toLowerCase() === session.matchName.toLowerCase())
      if (index === -1) {
        throw new Error(`Could not find "${session.matchName}" in ${path} anymore. Add it fresh with /new${thingFor(session.collection)}.`)
      }
      next = [...file.data]
      // Spread the stored record first so fields the bot no longer asks about
      // (e.g. the retired `pace`) survive the edit untouched.
      next[index] = { ...file.data[index], ...answered, last_updated: todayInDubai() }
      record = next[index]
    } else {
      if (file.data.some((item) => item.name.toLowerCase() === answered.name.toLowerCase())) {
        throw new Error(`"${answered.name}" already exists in ${path}. Use /edit${thingFor(session.collection)} ${answered.name} instead.`)
      }
      record = { ...answered, last_updated: todayInDubai() }
      next = [...file.data, record]
    }

    const result = await updateJsonFile({ ...base, sha: file.sha, data: next, message: `data: ${session.action} ${answered.name}` })
    return { result, record }
  }

  // Two writes, in a fixed order: the GitHub commit, then the database row. The
  // commit is remembered on the session as soon as it lands, so a database
  // failure can be retried by tapping Approve again without committing twice.
  bot.callbackQuery(/^approve:(.+)$/, async (ctx) => {
    const session = sessions.get(chatKeyOf(ctx))
    if (!session || session.mode !== 'preview' || session.previewId !== ctx.match[1]) {
      await ctx.answerCallbackQuery({ text: 'This preview has expired. Please build it again.' })
      return
    }
    try {
      await ctx.answerCallbackQuery({ text: session.published ? 'Retrying the database…' : 'Publishing…' })

      if (!session.published) {
        await publishPendingUploads(ctx, session)
        const { result, record } = await publishSession(session)
        const kind = kindFor(session.collection)
        session.published = {
          name: record.name,
          commitUrl: result.commit.html_url,
          row: toRunRow(record, kind),
          // The slug before this edit, so a rename updates the same row.
          previousSlug: session.action === 'update' ? slugOf(session.matchName, kind) : null,
        }
        await checkpoint(ctx, session)
      }

      if (database) {
        await saveRun({ ...database, row: session.published.row, previousSlug: session.published.previousSlug, fetchImpl })
      }

      const { commitUrl } = session.published
      forget(ctx)
      await ctx.editMessageReplyMarkup().catch(() => {})
      await ctx.reply(database
        ? `Published to GitHub and saved to the database. GitHub Pages should update in about 1–2 minutes.\n${commitUrl}`
        : `Published to GitHub. GitHub Pages should update in about 1–2 minutes.\n${commitUrl}`)
    } catch (error) {
      persist(ctx, session)
      console.error(error)
      if (session.published) {
        await ctx.reply(`The site files are updated on GitHub, but the database write failed:\n${error.message}\n\n`
          + 'Tap Approve and publish again to retry just the database. Nothing will be committed twice.')
        return
      }
      await ctx.reply(`${error.message}\n\nYour answers are saved — tap Approve and publish again to retry. Already-uploaded photos won't be re-sent.`)
    }
  })

  bot.catch((error) => console.error('Unhandled bot error:', error.error))

  return { bot, render }
}
