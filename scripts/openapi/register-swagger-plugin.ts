/**
 * Compiles the apps with the Nest Swagger CLI plugin (the one nest-cli.json
 * enables for `nest build`) when the generator runs outside `nest build`.
 *
 * The plugin reads types through the TypeScript type checker, which the
 * `--transpile-only` ts-node of the command line does not have, and ts-node
 * cannot take a transformer from tsconfig. So this builds ONE ts.Program for
 * the eight apps, and installs a `.ts` require hook that emits each file
 * through `program.emit` with the plugin as a `before` transformer. Files
 * outside the program fall back to a plain transpile. No diagnostics are
 * reported: type errors are `tsc`'s job.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const ROOT = path.resolve(__dirname, '../..');

interface PluginConfig {
  name: string;
  options: Record<string, unknown>;
}

function swaggerPluginOptions(): Record<string, unknown> {
  const cli = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'nest-cli.json'), 'utf8'),
  ) as { compilerOptions: { plugins: PluginConfig[] } };
  const swagger = cli.compilerOptions.plugins.find(
    (p) => p.name === '@nestjs/swagger',
  );
  if (!swagger) throw new Error('nest-cli.json does not enable the plugin');
  return swagger.options;
}

export function registerSwaggerPlugin(appModules: string[]): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const plugin = require('@nestjs/swagger/plugin') as {
    before: (
      options: Record<string, unknown>,
      program: ts.Program,
    ) => ts.TransformerFactory<ts.SourceFile>;
  };
  const config = ts.getParsedCommandLineOfConfigFile(
    path.join(ROOT, 'tsconfig.json'),
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined },
  );
  if (!config) throw new Error('cannot read tsconfig.json');
  const options: ts.CompilerOptions = {
    ...config.options,
    noEmit: false,
    incremental: false,
    composite: false,
    tsBuildInfoFile: undefined,
    declaration: false,
    sourceMap: false,
    inlineSourceMap: false,
    outDir: undefined,
  };
  const program = ts.createProgram(appModules, options);
  const transformers: ts.CustomTransformers = {
    before: [plugin.before(swaggerPluginOptions(), program)],
  };
  const cache = new Map<string, string>();

  const compile = (file: string): string => {
    const hit = cache.get(file);
    if (hit !== undefined) return hit;
    const source = program.getSourceFile(file);
    let output: string | undefined;
    if (source) {
      program.emit(
        source,
        (name, text) => {
          if (name.endsWith('.js')) output = text;
        },
        undefined,
        false,
        transformers,
      );
    }
    output ??= ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: options,
      fileName: file,
    }).outputText;
    cache.set(file, output);
    return output;
  };

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Module = require('module') as {
    _extensions: Record<
      string,
      (
        module: { _compile(code: string, file: string): void },
        file: string,
      ) => void
    >;
  };
  Module._extensions['.ts'] = (module, file) => {
    module._compile(compile(file), file);
  };
}
