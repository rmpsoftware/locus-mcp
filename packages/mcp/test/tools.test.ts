import { describe, it } from "node:test";
import assert from "node:assert/strict";

const ALL_TOOLS = [
  { importPath: "../src/tools/locate.js", name: "locate", requiredProps: [] },
  { importPath: "../src/tools/refs.js", name: "refs", requiredProps: ["file"] },
  { importPath: "../src/tools/hover.js", name: "hover", requiredProps: [] },
  { importPath: "../src/tools/diagnostics.js", name: "diagnostics", requiredProps: [] },
  { importPath: "../src/tools/status.js", name: "status", requiredProps: [] },
  { importPath: "../src/tools/rename.js", name: "rename", requiredProps: ["new_name"] },
  { importPath: "../src/tools/list-projects.js", name: "list_projects", requiredProps: [] },
] as const;

describe("mcp tools", () => {
  const exportName = (name: string) => name === "list_projects" ? "listProjectsTool" : `${name}Tool`;

  it("exports exactly 7 tools", async () => {
    const modules = await Promise.all(
      ALL_TOOLS.map(async (t) => {
        const mod = await import(t.importPath);
        return mod[exportName(t.name) as keyof typeof mod];
      }),
    );

    assert.equal(modules.length, 7);
    const names = new Set(modules.map((t: { name: string }) => t.name));
    assert.equal(names.size, 7);
  });

  for (const spec of ALL_TOOLS) {
    it(`${spec.name} tool has valid MCP schema`, async () => {
      const mod = await import(spec.importPath);
      const tool = mod[exportName(spec.name) as keyof typeof mod] as {
        name: string;
        description: string;
        inputSchema: {
          type: string;
          properties?: Record<string, unknown>;
          required?: string[];
        };
      };

      assert.equal(tool.name, spec.name);
      assert.ok(tool.description.length > 10);
      assert.equal(tool.inputSchema.type, "object");

      for (const prop of spec.requiredProps) {
        assert.ok(
          tool.inputSchema.properties?.[prop],
          `expected property ${prop} in ${spec.name} schema`,
        );
        if (tool.inputSchema.required) {
          assert.ok(
            tool.inputSchema.required.includes(prop),
            `expected ${prop} in required array for ${spec.name}`,
          );
        }
      }
    });
  }

  it("exposes project and language filters on all language-server query tools", async () => {
    for (const spec of ALL_TOOLS.filter((t) => !["status", "list_projects"].includes(t.name))) {
      const mod = await import(spec.importPath);
      const tool = mod[exportName(spec.name) as keyof typeof mod] as {
        inputSchema: { properties: Record<string, unknown> };
      };
      assert.ok(tool.inputSchema.properties.project, spec.name);
      assert.ok(tool.inputSchema.properties.lang, spec.name);
    }
  });

  it("locate schema accepts name and file", async () => {
    const { locateTool } = await import("../src/tools/locate.js");
    assert.ok(locateTool.inputSchema.properties?.name);
    assert.ok(locateTool.inputSchema.properties?.file);
  });

  it("refs schema supports position shorthand", async () => {
    const { refsTool } = await import("../src/tools/refs.js");
    assert.ok(refsTool.inputSchema.properties?.position);
    assert.ok(refsTool.inputSchema.properties?.implementations);
  });

  it("rename schema requires new_name", async () => {
    const { renameTool } = await import("../src/tools/rename.js");
    assert.deepEqual(renameTool.inputSchema.required, ["new_name"]);
    assert.ok(renameTool.inputSchema.properties?.apply);
  });

  it("status schema has no required properties", async () => {
    const { statusTool } = await import("../src/tools/status.js");
    assert.equal(statusTool.inputSchema.properties && Object.keys(statusTool.inputSchema.properties).length, 0);
  });

  it("diagnostics schema supports file and workspace flags", async () => {
    const { diagnosticsTool } = await import("../src/tools/diagnostics.js");
    assert.ok(diagnosticsTool.inputSchema.properties?.file);
    assert.ok(diagnosticsTool.inputSchema.properties?.workspace);
  });
});
