/** Wraps async route handlers so thrown errors reach the error middleware. */
export default function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
