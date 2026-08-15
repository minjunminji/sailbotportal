import '@testing-library/jest-dom';

// Integration tests talk to the local Supabase stack; load its URL and keys.
// Harmless for unit tests, which simply never read these vars.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config({ path: '.env.local' });
