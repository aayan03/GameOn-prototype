/** Every endpoint answers in this shape so the frontend never guesses. */
export function ok(res, data, meta = undefined) {
  return res.json({ success: true, data, ...(meta ? { meta } : {}) });
}
export function created(res, data) {
  return res.status(201).json({ success: true, data });
}
