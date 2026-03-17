import { Client, GatewayIntentBits } from 'discord.js'
import axios from 'axios'
// import { franc } from 'franc'
import fs from 'fs'

const SETTINGS_FILE = './channels.json'

const loadSettings = () => {
  if (!fs.existsSync(SETTINGS_FILE)) {
    return { channels: {} }
  }
  return JSON.parse(fs.readFileSync(SETTINGS_FILE))
}

const saveSettings = settings => {
  fs.writeFileSync(
    SETTINGS_FILE,
    JSON.stringify(settings, null, 2)
  )
}


const DISCORD_TOKEN = process.env.DISCORD_TOKEN
const DEEPL_KEY = process.env.DEEPL_KEY


const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
})

const webhookCache = new Map()
/*
const detectLang = text => {

  const lang = franc(text)

  if (lang === 'jpn') return 'JA'
  if (lang === 'eng') return 'EN'

  return null
}
*/
const translate = async (text, target) => {

  const res = await axios.post(
    'https://api-free.deepl.com/v2/translate',
    {
      text: [text],
      target_lang: target.toUpperCase()
    },
    {
      headers: {
        'Authorization': `DeepL-Auth-Key ${DEEPL_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  )

  const data = res.data.translations[0]

  return {
    text: data.text,
    detected: data.detected_source_language.toLowerCase()
  }
}

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

const processMessage = async message => {

  if (message.author.bot) return
  if (message.webhookId) return

  const settings = loadSettings()
  const langs = settings.channels[message.channel.id]

  if (!langs) return

  const text = message.content?.trim()
  if (!text) return

  // とりあえずlang1に翻訳
  const result = await translate(text, langs[0])

  let target = langs[0]

  if (result.detected === langs[0]) {
    target = langs[1]
  }

  let translated = result.text

  // lang2へ再翻訳が必要な場合のみ実行
  if (target === langs[1]) {
    translated = (await translate(text, langs[1])).text
  }

  const webhook = await getWebhook(message.channel)

  await webhook.send({
    content: translated,
    username: message.member?.displayName || message.author.username,
    avatarURL: message.author.displayAvatarURL()
  })
}

client.on('messageCreate', processMessage)

client.once('clientReady', async () => {

  console.log(`Logged in as ${client.user.tag}`)

  const commands = [
    {
      name: 'translate-channel',
      description: 'Set translation languages for this channel',
      options: [
        {
          name: 'action',
          description: 'add or remove',
          type: 3,
          required: true,
          choices: [
            { name: 'add', value: 'add' },
            { name: 'remove', value: 'remove' }
          ]
        },
        {
          name: 'lang1',
          description: 'first language (ISO 639-1)',
          type: 3,
          required: false
        },
        {
          name: 'lang2',
          description: 'second language (ISO 639-1)',
          type: 3,
          required: false
        }
      ]
    }
  ]

  const guild = client.guilds.cache.first()

  await guild.commands.set(commands)
})

client.on('interactionCreate', async interaction => {

  if (!interaction.isChatInputCommand()) return

  if (interaction.commandName === 'translate-channel') {

    const action = interaction.options.getString('action')
    const lang1 = interaction.options.getString('lang1')
    const lang2 = interaction.options.getString('lang2')

    const channelId = interaction.channelId

    const settings = loadSettings()

    if (action === 'add') {

      if (!lang1 || !lang2) {
        await interaction.reply('Please specify lang1 and lang2')
        return
      }

      settings.channels[channelId] = [
        lang1.toLowerCase(),
        lang2.toLowerCase()
      ]

      saveSettings(settings)

      await interaction.reply(
        `Translation enabled: ${lang1} ↔ ${lang2}`
      )
    }

    if (action === 'remove') {

      delete settings.channels[channelId]
      saveSettings(settings)

      await interaction.reply('Translation disabled.')
    }
  }

  if (interaction.commandName === 'translate-list') {

    if (!settings.channels.length) {

      await interaction.reply('No translation channels set.')
      return
    }

    const list = settings.channels
      .map(id => `<#${id}>`)
      .join('\n')

    await interaction.reply(`Translation channels:\n${list}`)
  }
})

client.login(DISCORD_TOKEN)