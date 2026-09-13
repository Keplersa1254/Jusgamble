'use strict';

const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    RoleSelectMenuBuilder,
    ChannelSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    PermissionFlagsBits,
    MessageFlags,
    ChannelType
} = require('discord.js');

const Guild = require('../../models/Guild');
const { COLORS, formatCredits, footer } = require('../../utils/ui');

const DEFAULT_DESCRIPTION = 'No description provided.';

const STATUS = {
    active: '🟢 Active',
    disabled: '🔴 Disabled'
};

// Custom IDs for every component emitted by this command.
const ID = {
    menu: 'settings_menu',
    addRole: 'btn_add_role',
    removeRole: 'btn_remove_role',
    toggleRole: 'btn_toggle_role',
    removeSelect: 'settings_remove_select',
    toggleSelect: 'settings_toggle_select',
    backToMenu: 'settings_back_menu',
    backToShop: 'settings_back_shop',
    addModal: 'settings_add_modal',
    channelsSelect: 'settings_channels_select',
    clearChannels: 'btn_clear_channels'
};

const ID_SET = new Set(Object.values(ID));

/**
 * Ensures a Guild document exists for the given guild and returns it as a
 * plain object. Auto-creates it (with an empty shop) if missing.
 * @param {string} guildId
 * @returns {Promise<Object>}
 */
async function getOrCreateGuild(guildId) {
    return Guild.findOrCreate(guildId);
}

/**
 * Returns true if a member has server management permissions.
 * @param {import('discord.js').GuildMember} member
 * @returns {boolean}
 */
function isServerManager(member) {
    return member.permissions.has(PermissionFlagsBits.ManageGuild)
        || member.permissions.has(PermissionFlagsBits.Administrator);
}

/**
 * Builds a consistent Embed for settings responses.
 */
function buildEmbed(color, title, description, fields, date) {
    const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setDescription(description);
    if (fields && fields.length) embed.addFields(fields);
    embed.setFooter(footer('Settings', date));
    return embed;
}

/**
 * The root `/settings` menu: a select menu with the available categories.
 */
function buildMainMenuView() {
    const embed = new EmbedBuilder()
        .setColor(COLORS.NEUTRAL)
        .setTitle('⚙️ Server Settings Menu')
        .setDescription('Select a category below to manage your server settings.')
        .setFooter(footer('Settings'));

    const select = new StringSelectMenuBuilder()
        .setCustomId(ID.menu)
        .setPlaceholder('Choose a settings category')
        .addOptions([
            { label: 'Manage Shop Roles', value: 'menu_shop_roles', description: 'Add, remove, or toggle shop roles', emoji: '🛒' },
            { label: 'General Settings', value: 'menu_general_settings', description: 'Settings', emoji: '🔧' }
        ]);

    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select)] };
}

/**
 * The shop-roles editor: an embed listing configured roles plus the
 * Add / Remove / Toggle action buttons and a Back button.
 */
async function buildShopRolesView(interaction, note) {
    const guild = await getOrCreateGuild(interaction.guild.id);

    // Populate the role cache once so we can resolve display names.
    await interaction.guild.roles.fetch().catch(() => {});
    const nameOf = (roleId) => {
        const role = interaction.guild.roles.cache.get(roleId);
        return role ? role.name : 'Unknown role (' + roleId + ')';
    };

    let body;
    if (!guild.shopRoles || guild.shopRoles.length === 0) {
        body = 'No roles in the shop yet. Click **➕ Add Role** to add one.';
    } else {
        body = guild.shopRoles.map((entry, i) => {
            const status = entry.isActive ? STATUS.active : STATUS.disabled;
            const hasDesc = entry.description && entry.description !== DEFAULT_DESCRIPTION;
            const desc = hasDesc ? ' — ' + entry.description : '';
            return '**' + (i + 1) + '.** ' + nameOf(entry.roleId) + ' — ' + formatCredits(entry.price) + ' · ' + status + desc;
        }).join('\n');
    }

    if (note) body = note + '\n\n' + body;

    const embed = new EmbedBuilder()
        .setColor(COLORS.NEUTRAL)
        .setTitle('🛒 Shop Roles')
        .setDescription(body)
        .setFooter(footer('Settings', interaction.createdAt));

    const actions = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(ID.addRole).setLabel('Add Role').setEmoji('➕').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(ID.removeRole).setLabel('Remove Role').setEmoji('➖').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(ID.toggleRole).setLabel('Toggle Role').setEmoji('🔄').setStyle(ButtonStyle.Primary)
    );
    const nav = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(ID.backToMenu).setLabel('Back').setEmoji('⬅️').setStyle(ButtonStyle.Secondary)
    );

    return { embeds: [embed], components: [actions, nav] };
}

/**
 * A role-picker view used for the remove / toggle flows.
 */
function buildRoleSelectView(interaction, customId, title, prompt) {
    const embed = new EmbedBuilder()
        .setColor(COLORS.NEUTRAL)
        .setTitle(title)
        .setDescription(prompt)
        .setFooter(footer('Settings', interaction.createdAt));

    const select = new RoleSelectMenuBuilder()
        .setCustomId(customId)
        .setPlaceholder('Select a role')
        .setMinValues(1)
        .setMaxValues(1);

    const nav = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(ID.backToShop).setLabel('Back').setEmoji('⬅️').setStyle(ButtonStyle.Secondary)
    );

    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select), nav] };
}

/**
 * The modal used to add a new shop role.
 */
function buildAddModal() {
    const modal = new ModalBuilder()
        .setCustomId(ID.addModal)
        .setTitle('Add Shop Role');

    const roleIdInput = new TextInputBuilder()
        .setCustomId('role_id')
        .setLabel('Role ID')
        .setPlaceholder('Copy the role ID (right-click role → Copy ID)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(16)
        .setMaxLength(24);

    const priceInput = new TextInputBuilder()
        .setCustomId('price')
        .setLabel('Price (credits)')
        .setPlaceholder('e.g. 5000')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(7);

    const descriptionInput = new TextInputBuilder()
        .setCustomId('description')
        .setLabel('Description (optional)')
        .setPlaceholder('A short description of the role')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(200);

    modal.addComponents(
        new ActionRowBuilder().addComponents(roleIdInput),
        new ActionRowBuilder().addComponents(priceInput),
        new ActionRowBuilder().addComponents(descriptionInput)
    );

    return modal;
}

async function buildGeneralSettingsView(interaction) {
    const guild = await Guild.findOrCreate(interaction.guild.id);
    const allowed = guild.allowedChannels || [];

    let list;
    if (allowed.length === 0) {
        list = 'All Channels (No restriction)';
    } else {
        await interaction.guild.channels.fetch().catch(() => {});
        list = allowed.map((id) => {
            const channel = interaction.guild.channels.cache.get(id);
            return '• ' + (channel ? '#' + channel.name : '<#' + id + '>');
        }).join('\n');
    }

    const embed = new EmbedBuilder()
        .setColor(COLORS.NEUTRAL)
        .setTitle('🔧 General Settings')
        .setDescription('**Allowed Channels**\n' + list + '\n\nUse the dropdown below to allow channels, or clear all restrictions.')
        .setFooter(footer('Settings', interaction.createdAt));

    const select = new ChannelSelectMenuBuilder()
        .setCustomId(ID.channelsSelect)
        .setPlaceholder('Select channels to allow')
        .setChannelTypes(ChannelType.GuildText)
        .setMinValues(1)
        .setMaxValues(25);

    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(ID.clearChannels).setLabel('Clear Channel Restrictions').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(ID.backToMenu).setLabel('Back').setEmoji('⬅️').setStyle(ButtonStyle.Secondary)
    );

    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select), buttons] };
}

async function onChannelsSelect(interaction) {
    const guildId = interaction.guild.id;
    const selected = interaction.values; // string[] of channel IDs

    await interaction.deferUpdate();

    // Save the current selection directly (replace, not append) so deselected
    // channels are removed from `allowedChannels`.
    await Guild.updateOne(
        { guildId },
        { $set: { allowedChannels: selected } }
    );

    const view = await buildGeneralSettingsView(interaction);
    return interaction.editReply(view);
}

async function onClearChannels(interaction) {
    const guildId = interaction.guild.id;

    await interaction.deferUpdate();

    await Guild.updateOne({ guildId }, { $set: { allowedChannels: [] } });

    const view = await buildGeneralSettingsView(interaction);
    return interaction.editReply(view);
}

async function onMenuSelect(interaction) {
    const value = interaction.values[0];

    if (value === 'menu_general_settings') {
        await interaction.deferUpdate();
        const view = await buildGeneralSettingsView(interaction);
        return interaction.editReply(view);
    }

    // Default: manage shop roles.
    await interaction.deferUpdate();
    const view = await buildShopRolesView(interaction);
    return interaction.editReply(view);
}

async function onAddRoleButton(interaction) {
    // showModal() is the response for this button — nothing is deferred.
    await interaction.showModal(buildAddModal());
}

async function onRemoveRoleButton(interaction) {
    await interaction.deferUpdate();
    return interaction.editReply(buildRoleSelectView(interaction, ID.removeSelect, '➖ Remove Role', 'Select the role to remove from the shop.'));
}

async function onToggleRoleButton(interaction) {
    await interaction.deferUpdate();
    return interaction.editReply(buildRoleSelectView(interaction, ID.toggleSelect, '🔄 Toggle Role', 'Select the role to enable or disable.'));
}

async function onRemoveSelect(interaction) {
    const roleId = interaction.values[0];
    const guildId = interaction.guild.id;

    await interaction.deferUpdate();

    const guild = await getOrCreateGuild(guildId);
    const existing = guild.shopRoles.find(r => r.roleId === roleId);

    if (!existing) {
        const view = await buildShopRolesView(interaction, '⚠️ That role is not in the shop.');
        return interaction.editReply(view);
    }

    await Guild.updateOne({ guildId }, { $pull: { shopRoles: { roleId: roleId } } });

    const view = await buildShopRolesView(interaction, '✅ Role removed from the shop.');
    return interaction.editReply(view);
}

async function onToggleSelect(interaction) {
    const roleId = interaction.values[0];
    const guildId = interaction.guild.id;

    await interaction.deferUpdate();

    const guild = await getOrCreateGuild(guildId);
    const existing = guild.shopRoles.find(r => r.roleId === roleId);

    if (!existing) {
        const view = await buildShopRolesView(interaction, '⚠️ That role is not in the shop.');
        return interaction.editReply(view);
    }

    const newState = !existing.isActive;
    await Guild.updateOne(
        { guildId, 'shopRoles.roleId': roleId },
        { $set: { 'shopRoles.$.isActive': newState } }
    );

    const view = await buildShopRolesView(interaction, (newState ? '✅' : '⛔') + ' Role ' + (newState ? 'enabled' : 'disabled') + ' (' + (newState ? STATUS.active : STATUS.disabled) + ').');
    return interaction.editReply(view);
}

async function onAddModalSubmit(interaction) {
    const guildId = interaction.guild.id;
    const roleId = interaction.fields.getTextInputValue('role_id').trim();
    const priceRaw = interaction.fields.getTextInputValue('price').trim();
    const description = (interaction.fields.getTextInputValue('description') || '').trim() || DEFAULT_DESCRIPTION;

    await interaction.deferUpdate();

    // Validate price is a whole number ≥ 1.
    const price = Number(priceRaw);
    if (!priceRaw || !Number.isInteger(price) || price < 1) {
        const view = await buildShopRolesView(interaction, '❌ Invalid price — enter a whole number of 1 or more.');
        return interaction.editReply(view);
    }

    // Resolve the role (must exist in this server).
    let role = interaction.guild.roles.cache.get(roleId);
    if (!role) {
        try {
            role = await interaction.guild.roles.fetch(roleId);
        } catch (_) {
            role = null;
        }
    }
    if (!role) {
        const view = await buildShopRolesView(interaction, '❌ Role not found. Paste a valid role ID from this server.');
        return interaction.editReply(view);
    }

    // Prevent duplicates.
    const guild = await getOrCreateGuild(guildId);
    if (guild.shopRoles.some(r => r.roleId === roleId)) {
        const view = await buildShopRolesView(interaction, '❌ `' + role.name + '` is already in the shop.');
        return interaction.editReply(view);
    }

    await Guild.updateOne(
        { guildId },
        { $push: { shopRoles: { roleId: roleId, price: price, description: description, isActive: true } } }
    );

    const view = await buildShopRolesView(interaction, '✅ Added `' + role.name + '` for ' + formatCredits(price) + '.');
    return interaction.editReply(view);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('settings')
        .setDescription('Manage server economy settings.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({
                content: '❌ This command can only be used in a server.',
                flags: MessageFlags.Ephemeral
            });
        }

        if (!interaction.member || !isServerManager(interaction.member)) {
            return interaction.reply({
                content: '❌ You need the `Manage Server` (or `Administrator`) permission to use this command.',
                flags: MessageFlags.Ephemeral
            });
        }

        const view = buildMainMenuView();
        await interaction.reply({ embeds: view.embeds, components: view.components, flags: MessageFlags.Ephemeral });
    },

    /**
     * Registers the interaction handler for every component (select menus,
     * buttons, role select menus, and modal submissions) emitted by /settings.
     * Called automatically during bot initialization.
     * @param {import('discord.js').Client} client
     */
    registerButtonHandler(client) {
        client.on('interactionCreate', async (interaction) => {
            const customId = interaction.customId;
            if (!customId || !ID_SET.has(customId)) return;

            // Defense-in-depth: only server managers may use the panel.
            if (interaction.guild && interaction.member && !isServerManager(interaction.member)) {
                return interaction.reply({
                    content: '❌ You need the `Manage Server` (or `Administrator`) permission.',
                    flags: MessageFlags.Ephemeral
                });
            }

            try {
                if (interaction.isStringSelectMenu() && customId === ID.menu) {
                    return await onMenuSelect(interaction);
                }

                if (interaction.isButton()) {
                    if (customId === ID.addRole) return await onAddRoleButton(interaction);
                    if (customId === ID.removeRole) return await onRemoveRoleButton(interaction);
                    if (customId === ID.toggleRole) return await onToggleRoleButton(interaction);
                    if (customId === ID.clearChannels) return await onClearChannels(interaction);

                    if (customId === ID.backToMenu) {
                        await interaction.deferUpdate();
                        return interaction.editReply(buildMainMenuView());
                    }
                    if (customId === ID.backToShop) {
                        await interaction.deferUpdate();
                        return interaction.editReply(await buildShopRolesView(interaction));
                    }
                }

                if (interaction.isRoleSelectMenu()) {
                    if (customId === ID.removeSelect) return await onRemoveSelect(interaction);
                    if (customId === ID.toggleSelect) return await onToggleSelect(interaction);
                }

                if (interaction.isChannelSelectMenu() && customId === ID.channelsSelect) {
                    return await onChannelsSelect(interaction);
                }

                if (interaction.isModalSubmit() && customId === ID.addModal) {
                    return await onAddModalSubmit(interaction);
                }
            } catch (error) {
                const code = error && (error.code ?? error.httpStatus);
                if (code === 10062 || code === 40060) return; // already acked / expired

                console.error('❌ settings component error:', error);
                try {
                    const payload = { content: 'An error occurred while handling that input.', flags: MessageFlags.Ephemeral };
                    if (interaction.replied || interaction.deferred) {
                        await interaction.followUp(payload);
                    } else {
                        await interaction.reply(payload);
                    }
                } catch (_) {
                    // Interaction already closed — nothing else we can do.
                }
            }
        });
    }
};


