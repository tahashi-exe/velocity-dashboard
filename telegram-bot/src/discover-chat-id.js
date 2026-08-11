import 'dotenv/config'

const token = process.env.TELEGRAM_BOT_TOKEN

if (!token) {
  throw new Error('Set TELEGRAM_BOT_TOKEN in .env before running this command.')
}

const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates`)
const payload = await response.json()

if (!payload.ok) {
  throw new Error(`Telegram error: ${payload.description || 'Unknown error'}`)
}

const update = [...payload.result]
  .reverse()
  .find((item) => item.message?.chat?.type === 'private')

if (!update) {
  throw new Error('No private messages found. Send /start to your bot, then run this command again.')
}

console.log(`Your Telegram chat ID is: ${update.message.chat.id}`)
console.log('Copy this value to TELEGRAM_ADMIN_CHAT_ID in .env, then start the bot.')
