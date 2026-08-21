import { z } from 'zod';
import mongoose from 'mongoose';
import { Notification } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ok } from '../utils/response.js';
import * as notify from '../services/notification.service.js';

export const listSchema = z.object({
  unread: z.enum(['true', 'false']).optional(),
  page: z.preprocess((v) => (v ? Number(v) : undefined), z.number().int().min(1).max(200).optional()),
}).strict();

export const markReadSchema = z.object({
  ids: z.array(z.string().regex(/^[0-9a-fA-F]{24}$/)).max(100).optional(),
}).strict();

export const pushTokenSchema = z.object({
  token: z.string().min(8).max(512),
  platform: z.enum(['web', 'android', 'ios']).optional(),
}).strict();

/** GET /api/notifications */
export const list = asyncHandler(async (req, res) => {
  const { unread, page = 1 } = req.validatedQuery || {};
  const limit = 25;

  // Always scoped to req.user — a notification id is never trusted as a
  // lookup key on its own.
  const filter = { user: req.user._id };
  if (unread === 'true') filter.readAt = null;

  const [items, total, unreadCount] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Notification.countDocuments(filter),
    notify.unreadCount(req.user._id),
  ]);

  return ok(res, items, { page, limit, total, unread: unreadCount, pages: Math.ceil(total / limit) || 1 });
});

/** GET /api/notifications/unread-count — polled by the bell. */
export const unread = asyncHandler(async (req, res) =>
  ok(res, { unread: await notify.unreadCount(req.user._id) }));

/** PATCH /api/notifications/read — all, or a specific set. */
export const markRead = asyncHandler(async (req, res) => {
  const count = await notify.markRead(req.user._id, req.body?.ids);
  return ok(res, { marked: count, unread: await notify.unreadCount(req.user._id) });
});

/** DELETE /api/notifications/:id */
export const remove = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.badRequest('Invalid id');
  const gone = await Notification.findOneAndDelete({ _id: req.params.id, user: req.user._id });
  if (!gone) throw ApiError.notFound('Notification not found');
  return ok(res, { deleted: true });
});

/** POST /api/notifications/push-token — register this device. */
export const addPushToken = asyncHandler(async (req, res) => {
  await notify.registerPushToken(req.user, req.body.token, req.body.platform || 'web');
  return ok(res, { registered: true });
});

/** DELETE /api/notifications/push-token — called on logout. */
export const removePushToken = asyncHandler(async (req, res) => {
  const token = req.body?.token;
  if (typeof token !== 'string' || !token) throw ApiError.badRequest('token is required');
  await notify.removePushToken(req.user, token);
  return ok(res, { removed: true });
});
