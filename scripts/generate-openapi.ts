/**
 * Generates the OpenAPI documents from the real controllers, with no database,
 * queue or Redis (the apps are created with `preview: true`):
 *
 *   docs/openapi/<service>.json  one per service, the service's own paths
 *   docs/openapi/openapi.json    ONE document with the GATEWAY paths
 *                                (`/<service>` + service path, as in krakend.json)
 *
 *   pnpm openapi                      (= ts-node ... scripts/generate-openapi.ts)
 *   pnpm openapi --out some/folder    write somewhere else (the docs workflow does)
 *   --meta file.json                  also write what the drift test needs: per-route auth
 *                                     metadata and routes the gateway does not expose
 *
 * DTO fields come from the Nest Swagger plugin that nest-cli.json enables for
 * `nest build`; under ts-node it is applied by ./openapi/register-swagger-plugin.
 * See docs/guides/openapi.md.
 */
import * as fs from 'fs';
import * as path from 'path';
import { SERVICES } from './openapi/create-documents';
import { registerSwaggerPlugin } from './openapi/register-swagger-plugin';

async function main(): Promise<void> {
  const outFlag = process.argv.indexOf('--out');
  const outDir = path.resolve(
    outFlag > -1
      ? process.argv[outFlag + 1]
      : path.join(__dirname, '../docs/openapi'),
  );

  registerSwaggerPlugin(
    SERVICES.map((s) =>
      path.resolve(__dirname, `../apps/${s}/src/app.module.ts`),
    ),
  );
  const { buildDocuments } = await import('./openapi/build');
  const { services, access, merged, unexposed } = await buildDocuments();

  fs.mkdirSync(outDir, { recursive: true });
  const write = (name: string, doc: unknown) =>
    fs.writeFileSync(
      path.join(outDir, name),
      `${JSON.stringify(doc, null, 2)}\n`,
    );
  for (const service of SERVICES) write(`${service}.json`, services[service]);
  write('openapi.json', merged);

  const metaFlag = process.argv.indexOf('--meta');
  if (metaFlag > -1) {
    fs.writeFileSync(
      path.resolve(process.argv[metaFlag + 1]),
      JSON.stringify({ access, unexposed }),
    );
  }

  const count = (doc: { paths: Record<string, object> }) =>
    Object.values(doc.paths).reduce(
      (n, item) => n + Object.keys(item).length,
      0,
    );
  for (const service of SERVICES) {
    console.info(
      `${service.padEnd(12)} ${count(services[service])} operations`,
    );
  }
  console.info(
    `${'merged'.padEnd(12)} ${count(merged)} operations -> ${outDir}`,
  );

  const stray = unexposed.filter((u) => !u.alias);
  for (const u of stray) {
    console.warn(
      `not in krakend: ${u.method.toUpperCase()} /${u.service}${u.path} (left out of the merged document)`,
    );
  }
}

void main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
