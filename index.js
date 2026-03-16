import { Client, GatewayIntentBits } from 'discord.js'
import axios from 'axios'
import { franc } from 'franc'

const DISCORD_TOKEN = process.env.DISCORD_TOKEN
const DEEPL_KEY = process.env.DEEPL_KEY

// 翻訳対象チャンネル
const TARGET_CHANNELS = [
  'CHANNEL_ID'
]

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
})

// webhook cache
const webhookCache = new Map()

// 翻訳キャッシュ
const translationCache = new Map()

// URL除外
const hasUrl = text => /https?:\/\/\S+/i.test(text)

// コード除外
const hasCode = text => /```/.test(text)

// 言語検出
const detectLang = text => {
  const lang = franc(text)

  if (lang === 'jpn') return 'JA'
  if (lang === 'eng') return 'EN'

  return null
}

// DeepL翻訳
const translate = async (text, target) => {

  const cacheKey = `${text}_${target}`

  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey)
  }

  const res = await axios.post(
    'https://api-free.deepl.com/v2/translate',
    new URLSearchParams({
      auth_key: DEEPL_KEY,
      text,
      target_lang: target
    })
  )

  const translated = res.data.translations[0].text

  translationCache.set(cacheKey, translated)

  return translated
}

// webhook取得
const getWebhook = async channel => {

  if (webhookCache.has(channel.id)) {
    return webhookCache.get(channel.id)
  }

  const hooks = await channel.fetchWebhooks()

  let hook = hooks.find(h => h.owner.id === client.user.id)

  if (!hook) {
    hook = await channel.createWebhook({
      name: 'Translator'
    })
  }

  webhookCache.set(channel.id, hook)

  return hook
}

// 翻訳処理
const processMessage = async message => {

  if (!message.content) return
  if (hasUrl(message.content)) return
  if (hasCode(message.content)) return

  const lang = detectLang(message.content)

  if (!lang) return

  const target = lang === 'JA' ? 'EN' : 'JA'

  const translated = await translate(message.content, target)

  if (!translated || translated === message.content) return

  const webhook = await getWebhook(message.channel)

  await webhook.send({
    content: translated,
    username: message.member?.displayName || message.author.username,
    avatarURL: message.author.displayAvatarURL()
  })
}

// 新規メッセージ
client.on('messageCreate', async message => {

  if (message.author.bot) return
  if (!TARGET_CHANNELS.includes(message.channel.id)) return

  try {
    await processMessage(message)
  } catch (err) {
    console.error(err)
  }

})

// 編集時再翻訳
client.on('messageUpdate', async (_, newMessage) => {

  if (!newMessage.author) return
  if (newMessage.author.bot) return
  if (!TARGET_CHANNELS.includes(newMessage.channel.id)) return

  try {
    await processMessage(newMessage)
  } catch (err) {
    console.error(err)
  }

})

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`)
})

client.login(DISCORD_TOKEN)