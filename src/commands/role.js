'use strict';

const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    MessageFlags
} = require('discord.js');

const Guild = require('../../models/Guild');
const User = require('../../models/User');
const balanceManager = require('../../games/balance');
const { COLORS, formatCredits, footer } = require('../../utils/ui');

const SHOP_SELECT_ID = 'role_shop_select';
const MANAGE_SELECT_ID = 'role_manage_select';

/**
 * Formats a number as a plain credits string (no currency emoji) for use in
 * select-menu option descriptions.
 */
function credits(price) {
    return Number(price).toLocaleString('en-US') + ' credits';
}

/**
 * Resolves the best-available display name for a role ID.
 */
function nameFor(guild, roleId) {
    const role = guild.roles.cache.get(roleId);
    return role ? role.name : 'Unknown role (' + roleId + ')';
}

/**
 * `/role manage` — lists the user's owned shop roles (that still exist in
 * this server) with their equipped status, plus a select menu to toggle them.
 */
async function handleManage(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const userId = interaction.user.id;
    const guild = interaction.guild;

    await guild.roles.fetch().catch(() => {});

    const user = await User.findOne({ userId }).lean();
    const inventory = (user && user.inventory) || [];

    // Map defensively — items may be objects ({ roleId, purchasedAt }) or plain strings.
    const ownedRoleIds = inventory
        .map((item) => (typeof item === 'object' && item !== null ? item.roleId : item))
        .filter(Boolean);

    // Only roles that still exist in this server are manageable here.
    const owned = ownedRoleIds
        .filter((roleId) => guild.roles.cache.has(roleId))
        .map((roleId) => ({ roleId: roleId }));

    if (owned.length === 0) {
        const embed = new EmbedBuilder()
            .setColor(COLORS.NEUTRAL)
            .setTitle('🎒 My Shop Roles')
            .setDescription("You don't own any shop roles yet. Buy one with `/role shop`!")
            .setFooter(footer('Role Shop', interaction.createdAt));
        return interaction.editReply({ embeds: [embed] });
    }

    // Fresh member so equipped status is current.
    const member = await guild.members.fetch({ user: userId, force: true })
        .catch(() => interaction.member);

    const lines = owned.map((item) => {
        const equipped = member.roles.cache.has(item.roleId);
        return (equipped ? '🟢 Equipped' : '🔴 Not Equipped') + ' — **' + nameFor(guild, item.roleId) + '**';
    }).join('\n');

    const embed = new EmbedBuilder()
        .setColor(COLORS.NEUTRAL)
        .setTitle('🎒 My Shop Roles')
        .setDescription('Select a role below to equip or unequip it.\n\n' + lines)
        .setFooter(footer('Role Shop', interaction.createdAt));

    const options = owned.slice(0, 25).map((item) => {
        const equipped = member.roles.cache.has(item.roleId);
        return {
            label: (equipped ? '🟢 ' : '🔴 ') + nameFor(guild, item.roleId),
            value: item.roleId,
            description: equipped ? 'Equipped — click to unequip' : 'Not equipped — click to equip'
        };
    });

    const select = new StringSelectMenuBuilder()
        .setCustomId(MANAGE_SELECT_ID)
        .setPlaceholder('Choose a role to equip/unequip')
        .addOptions(options);

    return interaction.editReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(select)] });
}

/**
 * Handles the equip/unequip select for `/role manage`.
 */
async function handleManageSelection(interaction) {
    const roleId = interaction.values[0];
    const userId = interaction.user.id;

    try {
        await interaction.deferUpdate();

        // Verify the user actually owns this role before toggling.
        const user = await User.findOne({ userId }).lean();
        const owns = user && Array.isArray(user.inventory) && user.inventory.some(
            (item) => (typeof item === 'object' && item !== null ? item.roleId : item) === roleId
        );
        if (!owns) {
            return interaction.followUp({ content: "❌ You don't own that role.", flags: MessageFlags.Ephemeral });
        }

        const member = await interaction.guild.members.fetch({ user: userId, force: true })
            .catch(() => interaction.member);
        const role = interaction.guild.roles.cache.get(roleId);
        const roleName = role ? role.name : 'that role';
        const equipped = member.roles.cache.has(roleId);

        try {
            if (equipped) {
                await member.roles.remove(roleId);
            } else {
                await member.roles.add(roleId);
            }
        } catch (toggleErr) {
            const code = toggleErr && (toggleErr.code ?? toggleErr.httpStatus);
            const hierarchy = code === 50013 || code === 50005 || code === 403;
            const msg = hierarchy
                ? "❌ I couldn't update that role (it is above my role, or I lack the `Manage Roles` permission)."
                : '❌ Failed to update the role. Please try again.';
            return interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral });
        }

        const embed = new EmbedBuilder()
            .setColor(equipped ? COLORS.NEUTRAL : COLORS.SUCCESS)
            .setTitle((equipped ? '⛔' : '✅') + ' Role ' + (equipped ? 'Unequipped' : 'Equipped'))
            .setDescription('`' + roleName + '` has been ' + (equipped ? 'unequipped' : 'equipped') + '.')
            .setFooter(footer('Role Shop', interaction.createdAt));

        return interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
    } catch (error) {
        console.error('❌ role manage error:', error);
        try {
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: 'An error occurred while managing your roles.', flags: MessageFlags.Ephemeral });
            } else {
                await interaction.reply({ content: 'An error occurred while managing your roles.', flags: MessageFlags.Ephemeral });
            }
        } catch (_) { /* interaction closed */ }
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('role')
        .setDescription('View and purchase roles from the server shop.')
        .setDMPermission(false)
        .addSubcommand((sub) =>
            sub.setName('shop').setDescription('Browse the server role shop.')
        )
        .addSubcommand((sub) =>
            sub.setName('manage').setDescription('Equip or unequip the shop roles you own.')
        ),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({
                content: '❌ This command can only be used in a server.',
                flags: MessageFlags.Ephemeral
            });
        }

        if (interaction.options.getSubcommand() === 'manage') {
            return handleManage(interaction);
        }

        await interaction.deferReply({ ephemeral: true });

        const guild = await Guild.findOrCreate(interaction.guild.id);
        const activeRoles = (guild.shopRoles || []).filter((r) => r.isActive);

        if (activeRoles.length === 0) {
            const embed = new EmbedBuilder()
                .setColor(COLORS.NEUTRAL)
                .setTitle('🛒 Server Role Shop')
                .setDescription('There are no roles available in the shop.')
                .setFooter(footer('Role Shop', interaction.createdAt));
            return interaction.editReply({ embeds: [embed] });
        }

        // Populate the role cache so names resolve for the listing + menu.
        await interaction.guild.roles.fetch().catch(() => {});

        const lines = activeRoles.map((entry, i) => {
            const desc = entry.description && entry.description !== 'No description provided.'
                ? ' — ' + entry.description
                : '';
            return '**' + (i + 1) + '.** ' + nameFor(interaction.guild, entry.roleId) + ' — ' + formatCredits(entry.price) + desc;
        }).join('\n');

        const embed = new EmbedBuilder()
            .setColor(COLORS.NEUTRAL)
            .setTitle('🛒 Server Role Shop')
            .setDescription(lines)
            .setFooter(footer('Role Shop', interaction.createdAt));

        // Discord allows at most 25 select options.
        const options = activeRoles.slice(0, 25).map((entry) => ({
            label: nameFor(interaction.guild, entry.roleId),
            value: entry.roleId,
            description: credits(entry.price)
        }));

        const select = new StringSelectMenuBuilder()
            .setCustomId(SHOP_SELECT_ID)
            .setPlaceholder('Choose a role to purchase')
            .addOptions(options);

        return interaction.editReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(select)] });
    },

    /**
     * Handles the purchase select menu emitted by /role shop.
     * @param {import('discord.js').Client} client
     */
    registerButtonHandler(client) {
        client.on('interactionCreate', async (interaction) => {
            if (!interaction.isStringSelectMenu()) return;

            if (interaction.customId === MANAGE_SELECT_ID) {
                return handleManageSelection(interaction);
            }

            if (interaction.customId !== SHOP_SELECT_ID) return;

            const roleId = interaction.values[0];
            const guildId = interaction.guild.id;
            const userId = interaction.user.id;

            try {
                await interaction.deferUpdate();

                // Re-fetch the shop entry — it must still exist and be active.
                const doc = await Guild.findOne(
                    { guildId, 'shopRoles.roleId': roleId },
                    { 'shopRoles.$': 1 }
                ).lean();
                const entry = doc && doc.shopRoles && doc.shopRoles[0];
                if (!entry || entry.roleId !== roleId || !entry.isActive) {
                    return interaction.followUp({
                        content: '❌ That role is no longer available in the shop.',
                        flags: MessageFlags.Ephemeral
                    });
                }

                // DB is the source of truth for ownership: check `inventory`,
                // not the Discord role, so an unequipped role isn't re-purchased.
                const userData = await User.findOne({ userId }).lean();
                const alreadyOwnedInDB = userData && Array.isArray(userData.inventory)
                    ? userData.inventory.some((i) => (typeof i === 'object' && i !== null ? i.roleId : i) === roleId)
                    : false;

                if (alreadyOwnedInDB) {
                    return interaction.followUp({
                        content: '❌ You already purchased this role! Use `/role manage` to equip it.',
                        flags: MessageFlags.Ephemeral
                    });
                }

                const balance = await balanceManager.getBalance(userId);
                if (balance < entry.price) {
                    return interaction.followUp({
                        content: '❌ Insufficient coins! You need ' + formatCredits(entry.price) + ' but only have ' + formatCredits(balance) + '.',
                        flags: MessageFlags.Ephemeral
                    });
                }

                // 1) Deduct the balance.
                await balanceManager.updateBalance(userId, balance - entry.price);

                // 2) Save ownership to MongoDB (inventory is the source of truth).
                try {
                    await User.findOneAndUpdate(
                        { userId, 'inventory.roleId': { $ne: roleId } },
                        {
                            $set: { guildId: guildId },
                            $addToSet: { inventory: { roleId: roleId, purchasedAt: new Date() } }
                        },
                        { new: true }
                    );
                } catch (saveErr) {
                    await balanceManager.updateBalance(userId, balance).catch(() => {});
                    return interaction.followUp({
                        content: '❌ Failed to save your purchase. Your coins were refunded.',
                        flags: MessageFlags.Ephemeral
                    });
                }

                // 3) Give the Discord role; roll back balance + inventory if it fails.
                try {
                    await interaction.member.roles.add(roleId);
                } catch (addErr) {
                    await balanceManager.updateBalance(userId, balance).catch(() => {});
                    await User.updateOne({ userId }, { $pull: { inventory: { roleId: roleId } } }).catch(() => {});

                    const code = addErr && (addErr.code ?? addErr.httpStatus);
                    const hierarchy = code === 50013 || code === 50005 || code === 403;
                    const msg = hierarchy
                        ? '❌ I couldn\'t assign that role (it is above my role, or I lack permissions). Your coins were refunded.'
                        : '❌ Failed to assign the role. Your coins were refunded. Please try again.';
                    return interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral });
                }

                const success = new EmbedBuilder()
                    .setColor(COLORS.SUCCESS)
                    .setTitle('✅ Purchase Complete')
                    .setDescription('You bought the role for **' + formatCredits(entry.price) + '**.')
                    .addFields(
                        { name: 'Role', value: '<@&' + roleId + '>', inline: true },
                        { name: 'Price', value: formatCredits(entry.price), inline: true },
                        { name: 'New Balance', value: formatCredits(balance - entry.price), inline: true }
                    )
                    .setFooter(footer('Role Shop', interaction.createdAt));

                return interaction.followUp({ embeds: [success], flags: MessageFlags.Ephemeral });
            } catch (error) {
                console.error('❌ role shop error:', error);
                try {
                    if (interaction.replied || interaction.deferred) {
                        await interaction.followUp({ content: 'An error occurred while processing your purchase.', flags: MessageFlags.Ephemeral });
                    } else {
                        await interaction.reply({ content: 'An error occurred while processing your purchase.', flags: MessageFlags.Ephemeral });
                    }
                } catch (_) { /* interaction closed */ }
            }
        });
    }
};
