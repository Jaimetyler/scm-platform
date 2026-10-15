import { createHandler } from '../fixture.mjs';
// A fresh handler per invocation prevents shared mutable scenario state.
export default async function handler(req, res) { return createHandler({ hosted: true })(req, res); }
