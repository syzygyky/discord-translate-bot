import { Client, GatewayIntentBits, MessageFlags } from 'discord.js'
import axios from 'axios'
// import { franc } from 'franc'
import fs from 'fs'

import http from 'http'

import * as grouproles from './commands/grouproles.js'

const PORT = process.env.PORT || 3000

process.on('unhandledRejection', err => {
  console.error('UNHANDLED REJECTION', err)
})

process.on('uncaughtException', err => {
  console.error('UNCAUGHT EXCEPTION', err)
})

http.createServer((req, res) => {
  res.end('OK')
}).listen(PORT)

const glossary = JSON.parse(fs.readFileSync('./glossary.json', 'utf8'))

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
const escapeRegExp = str =>
  str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const applyGlossary = (text, glossary) => {
  let result = text

  for (const [key, value] of Object.entries(glossary)) {
    const regex = new RegExp(escapeRegExp(key), 'gi')
    result = result.replace(regex, value)
  }

  return result
}

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
  const hooks = await channel.fetchWebhooks()

  let hook = hooks.find(
    h => h.owner.id === channel.client.user.id && h.name === 'Translator'
  )

  if (!hook) {
    hook = await channel.createWebhook({
      name: 'Translator'
    })
  }

  return hook
}

const getTargetMessage = async (interaction, messageId) => {
  const channel = interaction.channel

  if (messageId) {
    try {
      return await channel.messages.fetch(messageId)
    } catch {
      return null
    }
  }

  const messages = await channel.messages.fetch({ limit: 5 })

  return messages
    .filter(m => !m.author.bot)
    .first()
}

const processMessage = async message => {

  if (message.author.bot) return
  if (message.webhookId) return

  const settings = loadSettings()
  const langs = settings.channels[message.channel.id]

  if (!langs) return

  let text = message.content?.trim()
  if (!text) return
  text = applyGlossary(text, glossary.before)
  
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

  translated = applyGlossary(translated, glossary.after)
  
  // if(translated.length > 2000) translated = "Error: Translated message must be 2,000 characters or fewer."
  
  const webhook = await getWebhook(message.channel)
  
  const chunks = translated.match(/[\s\S]{1,2000}/g) || []

  for (const chunk of chunks) {
    await webhook.send({
      content: chunk,
      username: message.member?.displayName || message.author.username,
      avatarURL: message.author.displayAvatarURL()
    })
  }
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
          name: 'lang1',
          description: 'first language (ISO 639-1)',
          type: 3,
          required: true
        },
        {
          name: 'lang2',
          description: 'second language (ISO 639-1)',
          type: 3,
          required: true
        }
      ]
    },
    {
      name: 'translate',
      description: 'Translate a message',
      options: [
        {
          name: 'lang',
          description: 'Target Language (e.g. en, ja, es, zh)',
          required: true
        },
        {
          name: 'messageid',
          description: 'Message ID (optional)',
          required: false
        }
      ]
    },
    {
      name: 'translate-disable',
      description: 'Disable translation for this channel'
    }
  ]

  commands.push(grouproles.data.toJSON())

  const guild = client.guilds.cache.first()

  await guild.commands.set(commands)
})

client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isButton()) {
      await grouproles.handleButton(interaction)
      return
    }

    if (!interaction.isChatInputCommand()) return

    if (interaction.commandName === 'translate') {
      const lang = interaction.options.getString('lang')
      const messageId = interaction.options.getString('messageid')

      await interaction.deferReply({ ephemeral: true })

      const targetMessage = await getTargetMessage(interaction, messageId)

      if (!targetMessage) {
        await interaction.editReply('Message not found.')
        return
      }

      if (!targetMessage.content) {
        await interaction.editReply('Message has no text content.')
        return
      }

      const settings = loadSettings()
      const glossary = settings.glossary || {}

      const before = applyGlossary(
        targetMessage.content,
        glossary.before || {}
      )

      try {
        const result = await translate(before, lang)

        const after = applyGlossary(
          result.text,
          glossary.after || {}
        )

        const webhook = await getWebhook(interaction.channel)

        const chunks = after.match(/[\s\S]{1,2000}/g) || []

        // ACK削除（UIに残さない）
        await interaction.deleteReply()

        for (const chunk of chunks) {
          await webhook.send({
            content: chunk,
            username: targetMessage.member?.displayName
              || targetMessage.author.username,
            avatarURL: targetMessage.author.displayAvatarURL()
          })
        }

      } catch (err) {
        console.error(err)
        await interaction.editReply('Translation failed.')
      }
    }

    if (!interaction.member.permissions.has('ManageGuild')) {
      await interaction.reply({
        content: 'You need Manage Server permission.',
        flags: MessageFlags.Ephemeral
      })
      return
    }
    
    if (interaction.commandName === 'grouproles') {
      await grouproles.execute(interaction)
      return
    }

    if (interaction.commandName === 'translate-channel') {

      const lang1 = interaction.options.getString('lang1')
      const lang2 = interaction.options.getString('lang2')

      const channelId = interaction.channelId

      const settings = loadSettings()

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

    if (interaction.commandName === 'translate-disable') {

      const channelId = interaction.channelId
      const settings = loadSettings()

      delete settings.channels[channelId]
      saveSettings(settings)

      await interaction.reply('Translation disabled.')
    }

    if (interaction.commandName === 'translate-list') {
      const settings = loadSettings()

      const channelIds = Object.keys(settings.channels)

      if (channelIds.length === 0) {
        await interaction.reply('No translation channels set.')
        return
      }

      const list = channelIds
        .map(id => `<#${id}>`)
        .join('\n')

      await interaction.reply(`Translation channels:\n${list}`)
    }
  } catch (e) {
    console.error(e)
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({
        content: 'エラーが発生しました'
      });
    } else {
      await interaction.reply({
        content: 'エラーが発生しました',
        flags: MessageFlags.Ephemeral
      })
    }
  }
})

client.login(DISCORD_TOKEN)