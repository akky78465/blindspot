import { z } from 'zod';
import { FeatureMap, suggestionsSchema, TestCase } from '../schemas';
import { Agent } from './agent';

export interface EdgeInput { feature: FeatureMap['features'][number]; cases: TestCase[] }

export const edgeCase: Agent<EdgeInput, z.infer<typeof suggestionsSchema>> = {
  name: 'edge-case',
  output: suggestionsSchema,
  instructions: 'Find missing edge cases for this feature. For EVERY field and rule consider: boundary min/min-1/max/max+1; equivalence classes; null/empty/whitespace; invalid format; max length/overflow; special characters and Unicode; dates (leap year, past/future, time zones); invalid state transitions; roles/permissions; duplicates/concurrent submissions; SQL injection and XSS. Also find domain-specific gaps outside this checklist. Do not suggest cases already covered by the supplied cases. Each rationale must explain the specific gap relative to existing cases. Do not invent constraints: label assumptions and use rule-relative inputs where uncertain. Return at most 18 focused suggestions, priority high/medium/low. Use this feature ID. Data specs must describe synthetic values for code to generate, never real personal data. kind boundary uses params {min,max,side,offset}; invalid_length/long_string uses {length}; literal/date/duplicate uses {value}; number uses {min,max}. Use only supported schema kinds. Ensure date kinds use fixed dates and duplicate specs explicitly repeat the same value. Each expected result must name one outcome. When the feature states no rule, write one labeled assumption and test only that outcome. Do not write either, or, or must be confirmed. A date value must be YYYY-MM-DD, such as 2024-02-29. Do not invent password complexity. Unless the case is about the password characters, call it the account\'s stored password and do not include a sample. When the case is about those characters, the precondition must say that exact value is the stored credential. Do not treat a unique email as case-insensitive unless a supplied rule says so.',
  buildInput: ({ feature, cases }) => `Feature: ${JSON.stringify(feature)}\nExisting cases: ${JSON.stringify(cases)}`,
};
