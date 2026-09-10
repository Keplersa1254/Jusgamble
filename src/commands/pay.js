'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const balanceManager = require('../../games/balance');
const { COLORS, formatCredits, footer } = require('../../utils/ui');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('pay')
        .setDescription('Send coins to another player.')
        .addUserOption(function(opt) {
            return opt.setName('user')
                .setDescription('The player to pay')
                .setRequired(true);
        })
        .addIntegerOption(function(opt) {
            return opt.setName('amount')
                .setDescription('Amount of coins to send (min 1)')
                .setRequired(true)
                .setMinValue(1);
        }),

    async execute(interaction) {
        await interaction.deferReply();

        var target = interaction.options.getUser('user');
        var amount = interaction.options.getInteger('amount');
        var senderId = interaction.user.id;

        // Self-payment
        if (senderId === target.id) {
            return interaction.editReply({ content: '❌ You cannot pay yourself!' });
        }

        // Bot target
        if (target.bot) {
            return interaction.editReply({ content: '❌ You cannot send coins to a bot!' });
        }

        // Amount must be positive
        if (amount < 1) {
            return interaction.editReply({ content: '❌ Amount must be a positive whole number.' });
        }

        // Check sender balance
        var senderBal = await balanceManager.getBalance(senderId);
        if (senderBal < amount) {
            return interaction.editReply({ content: '❌ Your broke gng, you only have ' + formatCredits(senderBal) + '.' });
        }

        // Execute transfer
        var result = await balanceManager.transfer(senderId, target.id, amount);
        if (!result.success) {
            return interaction.editReply({ content: '❌ Transfer failed: ' + (result.error || 'unknown error') });
        }

        // Success embed
        var embed = new EmbedBuilder()
            .setColor(COLORS.SUCCESS)
            .setTitle('💸 Payment Successful!')
            .setDescription('Successfully sent **' + formatCredits(amount) + '** to <@' + target.id + '>!')
            .addFields(
                { name: 'Sender', value: '<@' + senderId + '>', inline: true },
                { name: 'Recipient', value: '<@' + target.id + '>', inline: true },
                { name: 'Amount', value: formatCredits(amount), inline: true },
                { name: 'Your Balance', value: formatCredits(result.fromBalance), inline: true }
            )
            .setFooter(footer('Payment', interaction.createdAt));

        await interaction.editReply({ embeds: [embed] });
    },

    balanceManager: balanceManager
};
