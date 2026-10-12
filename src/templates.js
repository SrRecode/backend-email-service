/** Transactional email templates with {{variable}} interpolation. */

export const TEMPLATES = {
  welcome: {
    subject: 'Welcome, {{name}}!',
    text: 'Hi {{name}},\n\nThanks for joining {{product}}. Reply to this email if you need anything.\n\n— The {{product}} team',
    html: '<h1>Welcome, {{name}}!</h1><p>Thanks for joining <strong>{{product}}</strong>.</p>',
    required: ['name', 'product'],
  },
  'reset-password': {
    subject: 'Reset your password',
    text: 'Hi {{name}},\n\nUse this code to reset your password: {{code}}\nIt expires in {{minutes}} minutes.',
    html: '<p>Hi {{name}}, your reset code is <strong>{{code}}</strong>.</p>',
    required: ['name', 'code', 'minutes'],
  },
  receipt: {
    subject: 'Your receipt for {{product}}',
    text: 'Thanks for buying {{product}}.\nTotal: {{total}}\nOrder: {{orderId}}',
    html: '<p>Thanks for buying <strong>{{product}}</strong>. Total: {{total}}.</p>',
    required: ['product', 'total', 'orderId'],
  },
};

export function interpolate(template, data = {}) {
  return String(template).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) =>
    data[key] === undefined || data[key] === null ? '' : String(data[key]),
  );
}

export function listTemplates() {
  return Object.entries(TEMPLATES).map(([id, template]) => ({
    id,
    subject: template.subject,
    required: template.required,
  }));
}

/** Render a template to {subject, text, html}, throwing {status:400} on problems. */
export function renderTemplate(id, data = {}) {
  const template = TEMPLATES[id];
  if (!template) {
    throw Object.assign(new Error(`Unknown template: ${id}`), { status: 400 });
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw Object.assign(new Error('template data must be an object'), { status: 400 });
  }
  const missing = template.required.filter(
    (key) => data[key] === undefined || data[key] === null || String(data[key]).trim() === '',
  );
  if (missing.length > 0) {
    throw Object.assign(new Error(`Missing template variables: ${missing.join(', ')}`), { status: 400 });
  }
  return {
    subject: interpolate(template.subject, data),
    text: interpolate(template.text, data),
    html: interpolate(template.html, data),
  };
}
