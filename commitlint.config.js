// @ts-check
const { RuleConfigSeverity } = require('@commitlint/types');

/** @type {import('@commitlint/types').UserConfig} */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Subject line: max 72 chars
    'header-max-length': [RuleConfigSeverity.Error, 'always', 72],
    // Subject line: min 10 chars (prevent "fix: x")
    'header-min-length': [RuleConfigSeverity.Error, 'always', 10],
    // Body line: max 72 chars
    'body-max-line-length': [RuleConfigSeverity.Error, 'always', 72],
    // Scope lowercase
    'scope-case': [RuleConfigSeverity.Error, 'always', 'lower-case'],
    // Subject: no period at end
    'subject-full-stop': [RuleConfigSeverity.Error, 'never', '.'],
    // Subject: lowercase start
    'subject-case': [
      RuleConfigSeverity.Error,
      'never',
      ['sentence-case', 'start-case', 'pascal-case', 'upper-case'],
    ],
    // Enforce types
    'type-enum': [
      RuleConfigSeverity.Error,
      'always',
      ['feat', 'fix', 'docs', 'chore', 'refactor', 'perf', 'test', 'style', 'ci', 'revert'],
    ],
  },
};
