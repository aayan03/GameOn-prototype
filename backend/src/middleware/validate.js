import ApiError from '../utils/ApiError.js';

/** Validates req[source] against a zod schema and replaces it with parsed data. */
export default function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const details = {};
      for (const issue of result.error.issues) {
        details[issue.path.join('.') || 'value'] = issue.message;
      }
      return next(ApiError.badRequest('Validation failed', details));
    }
    if (source === 'query') req.validatedQuery = result.data;
    else req[source] = result.data;
    next();
  };
}
