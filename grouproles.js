import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('grouproles')
  .setDescription('メッセージリンクからロール更新')
  .addStringOption(option =>
    option.setName('message_link')
      .setDescription('対象メッセージリンク')
      .setRequired(true)
  )

const roleMap = {
  'AMA☼TERASU': '1455546666282258492',
  AMATERASU: '1455546666282258492',
  H: '1447071062629028043',
  Y: '1447071131608813609',
  Q: '1447071199753408532',
  A: '1447071276240867382'
}

// 共通パーサ + 実行器
const processMessage = async ({ guild, client, link, dryRun }) => {
  const match = link.match(/channels\/(\d+)\/(\d+)\/(\d+)/)
  if (!match) throw new Error('invalid link')

  const [, guildId, channelId, messageId] = match

  if (guildId !== guild.id) {
    throw new Error('different guild')
  }

  const channel = await client.channels.fetch(channelId)
  const targetMessage = await channel.messages.fetch(messageId)

  const lines = targetMessage.content.split('\n')

  let currentFrom = null
  let currentTo = null

  const logs = []
  let success = 0
  let fail = 0
  let skip = 0

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const m = trimmed.match(/^(.+?)→(.+)$/)
    if (m) {
      currentFrom = m[1]
      currentTo = m[2]
      continue
    }

    const mentions = [...trimmed.matchAll(/<@!?(\d+)>/g)]

    for (const mm of mentions) {
      const userId = mm[1]

      // 未定義チェック
      const removeRoleId = roleMap[currentFrom]
      const addRoleId = roleMap[currentTo]

      if (!removeRoleId && !addRoleId) {
        logs.push(`SKIP ${userId} : role undefined (${currentFrom}→${currentTo})`)
        skip++
        continue
      }

      try {
        const member = await guild.members.fetch(userId)

        const actions = []

        if (removeRoleId) {
          actions.push(`- ${currentFrom}`)
          if (!dryRun) {
            await member.roles.remove(removeRoleId)
          }
        }

        if (addRoleId) {
          actions.push(`+ ${currentTo}`)
          if (!dryRun) {
            await member.roles.add(addRoleId)
          }
        }

        logs.push(`${member.user.tag} (${userId}) : ${actions.join(', ')}`)
        success++
      } catch (e) {
        logs.push(`FAILED ${userId} : ${e.message}`)
        fail++
      }
    }
  }

  return { logs, success, fail, skip }
}

export const execute = async interaction => {
  const link = interaction.options.getString('message_link')

  let result

  try {
    result = await processMessage({
      guild: interaction.guild,
      client: interaction.client,
      link,
      dryRun: true
    })
  } catch (e) {
    await interaction.reply({ content: `エラー: ${e.message}`, ephemeral: true })
    return
  }

  const output = result.logs.join('\n').slice(0, 1800)

  const button = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`grouproles_exec|${encodeURIComponent(link)}`)
      .setLabel('実行')
      .setStyle(ButtonStyle.Danger)
  )

  await interaction.reply({
    content:
      `DRY-RUN\n成功:${result.success} 失敗:${result.fail} SKIP:${result.skip}\n\n${output}`,
    components: [button],
    ephemeral: true
  })
}


export const handleButton = async interaction => {
  if (!interaction.isButton()) return

  if (!interaction.customId.startsWith('grouproles_exec|')) return

  const link = decodeURIComponent(interaction.customId.split('|')[1])

  await interaction.deferReply({ ephemeral: true })

  let result

  try {
    result = await processMessage({
      guild: interaction.guild,
      client: interaction.client,
      link,
      dryRun: false
    })
  } catch (e) {
    await interaction.editReply({ content: `エラー: ${e.message}` })
    return
  }

  const output = result.logs.join('\n').slice(0, 1800)

  await interaction.editReply({
    content:
      `実行完了\n成功:${result.success} 失敗:${result.fail} SKIP:${result.skip}\n\n${output}`,
    components: []
  })
}