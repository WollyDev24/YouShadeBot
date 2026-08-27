import crypto from "node:crypto";
import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags
} from "../lib/discord.js";
import { getData, save } from "./db.js";

function commitGuild(guildId, surveys) {
  getData().surveys[guildId] = surveys;
  save();
}

export function getSurveys(guildId) {
  return getData().surveys[guildId] ?? {};
}

export function getSurvey(guildId, id) {
  return getSurveys(guildId)[id] ?? null;
}

export function createSurvey(guildId, opts) {
  const surveys = getSurveys(guildId);
  const id = Object.keys(surveys).length
    ? Math.max(...Object.keys(surveys).map(Number)) + 1
    : 1;

  surveys[id] = {
    id,
    question: opts.question,
    description: opts.description ?? "",
    channelId: opts.channelId ?? null,
    responseChannelId: opts.responseChannelId ?? null,
    messageId: null,
    buttonLabel: opts.buttonLabel ?? "Take Survey",
    buttonEmoji: opts.buttonEmoji ?? "📋",
    color: opts.color ?? "#5865f2",
    responses: {}
  };

  commitGuild(guildId, surveys);
  return surveys[id];
}

export function updateSurvey(guildId, id, opts) {
  const surveys = getSurveys(guildId);
  const survey = surveys[id];
  if (!survey) return null;

  if (opts.question !== undefined) survey.question = opts.question;
  if (opts.description !== undefined) survey.description = opts.description;
  if (opts.channelId !== undefined) survey.channelId = opts.channelId;
  if (opts.responseChannelId !== undefined) survey.responseChannelId = opts.responseChannelId;
  if (opts.buttonLabel !== undefined) survey.buttonLabel = opts.buttonLabel;
  if (opts.buttonEmoji !== undefined) survey.buttonEmoji = opts.buttonEmoji;
  if (opts.color !== undefined) survey.color = opts.color;

  commitGuild(guildId, surveys);
  return survey;
}

export function deleteSurvey(guildId, id) {
  const surveys = getSurveys(guildId);
  const survey = surveys[id];
  if (!survey) return null;
  delete surveys[id];
  commitGuild(guildId, surveys);
  return survey;
}

export function buildSurveyMessage(guild, survey) {
  const color = parseInt(String(survey.color ?? "#5865f2").replace("#", ""), 16);
  const embed = new EmbedBuilder()
    .setColor(Number.isNaN(color) ? 0x5865f2 : color)
    .setTitle(survey.question)
    .setFooter({ text: `Survey #${survey.id}` })
    .setTimestamp();

  if (survey.description) {
    embed.setDescription(survey.description);
  }

  const responseCount = Object.keys(survey.responses).length;
  if (responseCount > 0) {
    embed.addFields({ name: "Responses", value: String(responseCount), inline: true });
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`sv_click:${survey.id}`)
      .setLabel(survey.buttonLabel.slice(0, 80))
      .setStyle(ButtonStyle.Primary)
  );

  if (survey.buttonEmoji) {
    try {
      row.components[0].setEmoji(survey.buttonEmoji);
    } catch {}
  }

  return { embeds: [embed], components: [row] };
}

export function surveyModal(survey) {
  const modal = new ModalBuilder()
    .setCustomId(`sv_modal:${survey.id}`)
    .setTitle(survey.question.slice(0, 100));

  const input = new TextInputBuilder()
    .setCustomId("answer")
    .setLabel(survey.question.slice(0, 100))
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(1000)
    .setRequired(true);

  if (survey.description) {
    input.setPlaceholder(survey.description.slice(0, 200));
  }

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

export function responseEmbed(user, answer, survey) {
  return new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(survey.question)
    .setDescription(answer)
    .addFields(
      { name: "User", value: `${user.displayName} (${user.username})`, inline: true }
    )
    .setThumbnail(user.displayAvatarURL({ size: 64 }))
    .setTimestamp();
}

export function addResponse(guildId, surveyId, user, answer) {
  const survey = getSurvey(guildId, surveyId);
  if (!survey) return null;
  survey.responses[user.id] = {
    displayName: user.displayName,
    username: user.username,
    answer,
    at: Date.now()
  };
  commitGuild(guildId, getSurveys(guildId));
  return survey;
}
