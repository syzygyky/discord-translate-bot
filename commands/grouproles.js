import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js'

const roleMap = {
  'AMA☼TERASU': '1455546666282258492',
  AMATERASU: '1455546666282258492',
  H: '1447071062629028043',
  Y: '1447071131608813609',
  Q: '1447071199753408532',
  A: '1447071276240867382'
}

const processRoleMessage = async ({ interaction, messageId, dryRun }) => {
  const channel = await interaction.client.channels.fetch(interaction.channelId);

  if (!channel || !channel.isTextBased()) {
    throw new Error('Invalid channel');
  }

  const message = await channel.messages.fetch(messageId)

  const lines = message.content.split('\n')

  let from = null
  let to = null

  const logs = []
  let success = 0
  let fail = 0
  let skip = 0

  for (const line of lines) {
    const t = line.trim()
    if (!t) continue

    const m = t.match(/^(.+?)→(.+)$/)
    if (m) {
      from = m[1]
      to = m[2]
      continue
    }

    const mentions = [...t.matchAll(/<@!?(\d+)>/g)]

    for (const mm of mentions) {
      const userId = mm[1]

      const removeRoleId = roleMap[from]
      const addRoleId = roleMap[to]

      if (!removeRoleId && !addRoleId) {
        logs.push(`SKIP ${userId} : ${from}→${to}`)
        skip++
        continue
      }

      try {
        const member = await interaction.guild.members.fetch(userId)

        const actions = []

        if (removeRoleId) {
          actions.push(`- ${from}`)
          if (!dryRun) await member.roles.remove(removeRoleId)
        }

        if (addRoleId) {
          actions.push(`+ ${to}`)
          if (!dryRun) await member.roles.add(addRoleId)
        }

        logs.push(`${member.user.tag} : ${actions.join(', ')}`)
        success++
      } catch (e) {
        logs.push(`FAILED ${userId} : ${e.message}`)
        fail++
      }
    }
  }

  return { logs, success, fail, skip }
}

// --- exports ---

export const data = new SlashCommandBuilder()
  .setName('grouproles')
  .setDescription('Apply roles from message ID')
  .addStringOption(option =>
    option.setName('message_id')
      .setDescription('target message ID')
      .setRequired(true)
  )

export const execute = async interaction => {
  const messageId = interaction.options.getString('message_id')

  let result
  try {
    result = await processRoleMessage({
      interaction,
      messageId,
      dryRun: true
    })
  } catch (e) {
    await interaction.reply({ content: e.message, flags: MessageFlags.Ephemeral })
    return
  }

  const button = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`grouproles|${messageId}`)
      .setLabel('実行')
      .setStyle(ButtonStyle.Danger)
  )

  const text = result.logs.join('\n').slice(0, 1800)

  await interaction.reply({
    content: `DRY-RUN\n成功:${result.success} 失敗:${result.fail} SKIP:${result.skip}\n\n${text}`,
    components: [button],
    flags: MessageFlags.Ephemeral
  })
}

export const handleButton = async interaction => {
  if (!interaction.customId.startsWith('grouproles|')) return;

  try {
    const messageId = interaction.customId.split('|')[1];

    await interaction.deferReply({
      flags: MessageFlags.Ephemeral
    });

    const result = await processRoleMessage({
      interaction,
      messageId,
      dryRun: false
    });

    const text = result.logs.join('\n').slice(0, 1800);

    await interaction.editReply({
      content: `完了\n成功:${result.success} 失敗:${result.fail} SKIP:${result.skip}\n\n${text}`
    });

  } catch (e) {
    console.error(e);

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply('エラーが発生しました');
    } else {
      await interaction.reply({
        content: 'エラーが発生しました',
        flags: MessageFlags.Ephemeral
      });
    }
  }
};