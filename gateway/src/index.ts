/**
 * Real process entry point -- the only file in this package with a
 * top-level side effect (actually binding a port). Everything else is
 * a plain, side-effect-free factory so tests can build and tear down
 * as many independent gateway instances as they need.
 */
import { createGatewayServer } from './server.js';

await createGatewayServer().listen();
