import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rmSync } from "node:fs";
import { fileExists } from "../artifacts/jsonArtifactIO";

let tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  tempDirectories = [];
  vi.doUnmock("node:fs/promises");
  vi.resetModules();
});

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "json-artifact-io-"));
  tempDirectories.push(directory);
  return directory;
}

describe("jsonArtifactIO fileExists", () => {
  it("returns true for existing files and false for missing paths", async () => {
    const directory = await createTempDirectory();
    const filePath = path.join(directory, "artifact.json");
    await writeFile(filePath, JSON.stringify({ ok: true }), "utf8");

    await expect(fileExists(filePath)).resolves.toBe(true);
    await expect(fileExists(path.join(directory, "missing.json"))).resolves.toBe(false);
    await expect(fileExists(null)).resolves.toBe(false);
  });

  it("preserves non-ENOENT failures for non-file paths", async () => {
    const directory = await createTempDirectory();
    const nestedDirectory = path.join(directory, "artifact-directory");
    await mkdir(nestedDirectory);

    await expect(fileExists(nestedDirectory)).rejects.toMatchObject({ code: "EISDIR" });
  });

  it("throws readability failures without reading file contents", async () => {
    vi.resetModules();
    const accessError = Object.assign(new Error("permission denied"), { code: "EACCES" });
    const readFile = vi.fn();

    vi.doMock("node:fs/promises", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs/promises")>();
      return {
        ...actual,
        stat: vi.fn(async () => ({ isFile: () => true })),
        access: vi.fn(async () => {
          throw accessError;
        }),
        readFile,
      };
    });

    const { fileExists: mockedFileExists } = await import("../artifacts/jsonArtifactIO");

    await expect(mockedFileExists("protected-artifact.json")).rejects.toBe(accessError);
    expect(readFile).not.toHaveBeenCalled();
  });
});
