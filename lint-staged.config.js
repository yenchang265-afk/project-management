// `next lint` shells through ESLint with the project's flat-/legacy-config
// loader, so we don't have to maintain a separate eslint.config.js for
// pre-commit. The `--file` flag scopes the run to only the staged files.
module.exports = {
  '*.{js,jsx,ts,tsx}': [
    (files) => `next lint --fix ${files.map((f) => `--file ${f}`).join(' ')}`,
    'prettier --write',
  ],
  '*.{json,md,yml,yaml}': ['prettier --write'],
};
