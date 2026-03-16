import { Client, GatewayIntentBits } from 'discord.js'
import axios from 'axios'
import { franc } from 'franc'

const DISCORD_TOKEN = process.env.DISCORD_TOKEN
const DEEPL_KEY = process.env.DEEPL_KEY

const settings = {
  channels: process.env.TRANSLATE_CHANNELS
    ? process.env.TRANSLATE_CHANNELS.split(',')
    : []
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
})

const webhookCache = new Map()

const detectLang = text => {

  const lang = franc(text)

  if (lang === 'jpn') return 'JA'
  if (lang === 'eng') return 'EN'

  return null
}

const translate = async (text, target) => {

  const res = await axios.post(
    'https://api-free.deepl.com/v2/translate',
    new URLSearchParams({
      auth_key: DEEPL_KEY,
      text,
      target_lang: target
    })
  )

  return res.data.translations[0].text
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

  if (!settings.channels.includes(message.channel.id)) return

  const text = message.content?.trim()

  if (!text) return

  const lang = detectLang(text)

  if (!lang) return

  const target = lang === 'JA'
    ? 'EN'
    : 'JA'

  const translated = await translate(text, target)

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
      description: 'Enable or disable translation in this channel',
      options: [
        {
          name: 'action',
          description: 'Add or remove translation for this channel',
          type: 3,
          required: true,
          choices: [
            { name: 'add', value: 'add' },
            { name: 'remove', value: 'remove' }
          ]
        }
      ]
    },
    {
      name: 'translate-list',
      description: 'Show translation channels'
    }
  ]

  const guild = client.guilds.cache.first()

  await guild.commands.set(commands)
})

client.on('interactionCreate', async interaction => {

  if (!interaction.isChatInputCommand()) return

  if (interaction.commandName === 'translate-channel') {

    const action = interaction.options.getString('action')
    const channelId = interaction.channelId

    if (action === 'add') {

      if (!settings.channels.includes(channelId)) {
        settings.channels.push(channelId)
      }

      await interaction.reply('Translation enabled.')

    }

    if (action === 'remove') {

      settings.channels = settings.channels.filter(
        id => id !== channelId
      )

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