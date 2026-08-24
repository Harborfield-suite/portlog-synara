import * as Crypto from "node:crypto";
import * as FS from "node:fs/promises";
import * as OS from "node:os";
import * as Path from "node:path";

import { RuntimeClient } from "./liveSmoke";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  const root = await FS.mkdtemp(Path.join(OS.tmpdir(), "portlog-product-proof-"));
  const dataDir = Path.join(root, "runtime");
  const artifactPath = Path.join(root, "artifacts", "plant.svg");
  await FS.mkdir(Path.dirname(artifactPath), { recursive: true });
  await FS.writeFile(artifactPath, "<svg data-proof=\"before\" />", "utf8");
  await FS.writeFile(
    Path.join(root, "portlog-project.json"),
    JSON.stringify({ artifacts: [{ id: "plant", path: "artifacts/plant.svg", kind: "drawing" }] }),
    "utf8",
  );

  const key = process.env.PORTLOG_OPENROUTER_API_KEY?.trim() || process.env.OPENROUTER_API_KEY?.trim() || "";
  const client = new RuntimeClient(key, dataDir, root);
  let restartedClient: RuntimeClient | null = null;
  try {
    await client.request("runtime.initialize", {
      supportedProtocolVersions: [1],
      clientVersion: "product-proof",
    });

    const models = await client.request<Array<{ ref: string; status: string }>>("model.list", {});
    assert(models.some((model) => model.ref === "openrouter/deepseek/deepseek-v4-flash"), "OpenRouter model missing");

    const project = await client.request<{ projectId: string }>("project.open", { root });
    const session = await client.request<{ sessionId: string }>("session.create", {
      projectId: project.projectId,
      modelRef: "openrouter/deepseek/deepseek-v4-flash",
      thinkingLevel: "low",
    });
    const attached = await client.request<{ sessionId: string }>("session.attach", {
      sessionId: session.sessionId,
    });
    assert(attached.sessionId === session.sessionId, "session could not be attached");
    const workspace = await client.request<{ entries: Array<{ locator: string; relativePath: string }> }>(
      "workspace.list",
      { projectId: project.projectId },
    );
    const artifact = await client.request<{ artifactId: string; locator: string; sha256: string }>(
      "artifact.describe",
      { projectId: project.projectId, artifactId: "plant" },
    );
    const content = await client.request<{ contents: string; version?: string }>("content.read", {
      locator: artifact.locator,
    });
    assert(content.contents.includes("data-proof=\"before\""), "artifact content was not readable");

    const updated = await client.request<{ version: string }>("content.write", {
      projectId: project.projectId,
      relativePath: "artifacts/plant.svg",
      contents: "<svg data-proof=\"after\" />",
      expectedVersion: content.version ?? null,
    });
    assert(updated.version.startsWith("sha256:"), "content write did not return a version");

    const evidence = await client.request<{ evidenceId: string }>("evidence.record", {
      projectId: project.projectId,
      artifactId: artifact.artifactId,
      sourceLocator: artifact.locator,
      sourceIdentity: "product-proof:plant.svg",
      sourceSha256: artifact.sha256,
      claim: "The PortLog artifact is inspectable through the runtime protocol.",
      claimStatus: "satisfied",
      supportStatus: "supported",
    });
    const storedEvidence = await client.request<{ evidenceId: string }>("evidence.get", {
      projectId: project.projectId,
      evidenceId: evidence.evidenceId,
    });
    assert(storedEvidence.evidenceId === evidence.evidenceId, "evidence could not be reloaded");

    const finding = await client.request<{ findingId: string }>("finding.record", {
      projectId: project.projectId,
      title: "Product proof",
      summary: "Project, artifact, content, and evidence operations completed through PortLog.",
      claimStatus: "satisfied",
      evidenceIds: [evidence.evidenceId],
    });
    const findings = await client.request<Array<{ findingId: string }>>("finding.list", {
      projectId: project.projectId,
    });
    assert(findings.some((item) => item.findingId === finding.findingId), "finding could not be reloaded");
    assert(workspace.entries.some((entry) => entry.relativePath === "artifacts"), "workspace listing missed artifacts");

    console.log("PASS model.list: PortLog model catalog available");
    console.log("PASS session.create/session.attach: session lifecycle opened");
    console.log("PASS project.open/workspace.list: project workbench opened");
    console.log("PASS artifact.describe/content.read: artifact inspection works");
    console.log("PASS content.write: workspace editing protocol works");
    console.log("PASS evidence.record/evidence.get: evidence persists");
    console.log("PASS finding.record/finding.list: findings persist");

    const interruptedTurnId = Crypto.randomUUID();
    if (key) {
      await client.request("turn.send", {
        sessionId: session.sessionId,
        turnId: interruptedTurnId,
        modelRef: "openrouter/deepseek/deepseek-v4-flash",
        thinkingLevel: "low",
        text: "Read fixture.txt and summarize it.",
      });
      client.forceKill();
    } else {
      await client.shutdown();
    }
    restartedClient = new RuntimeClient(key, dataDir, root);
    await restartedClient.request("runtime.initialize", {
      supportedProtocolVersions: [1],
      clientVersion: "product-proof-restart",
    });
    const recovered = await restartedClient.request<{
      sessionId: string;
      state: string;
    }>("session.attach", {
      sessionId: session.sessionId,
    });
    assert(recovered.sessionId === session.sessionId, "session did not recover after runtime restart");
    const history = await restartedClient.request<{
      turns: Array<{ turnId: string; state: string }>;
    }>("session.history", { sessionId: session.sessionId });
    if (key) {
      assert(recovered.state === "interrupted", `runtime restart state was ${recovered.state}`);
      const interruptedTurn = history.turns.find((turn) => turn.turnId === interruptedTurnId);
      assert(interruptedTurn?.state === "interrupted", "interrupted turn was not persisted");
      console.log("PASS interrupted turn recovery: forced runtime stop was surfaced safely");

      const cancellationTurnId = Crypto.randomUUID();
      const cancellationEvents: Array<{ readonly type: string; readonly turnId?: string; readonly state?: string }> = [];
      const unsubscribe = restartedClient.onEvent((event) => cancellationEvents.push(event));
      try {
        await restartedClient.request("turn.send", {
          sessionId: session.sessionId,
          turnId: cancellationTurnId,
          modelRef: "openrouter/deepseek/deepseek-v4-flash",
          thinkingLevel: "low",
          text: "Read fixture.txt and summarize it.",
        });
        await restartedClient.request("turn.cancel", {
          sessionId: session.sessionId,
          turnId: cancellationTurnId,
        });
        const deadline = Date.now() + 5_000;
        while (!cancellationEvents.some(
          (event) => event.type === "turn.completed" && event.turnId === cancellationTurnId && event.state === "cancelled",
        )) {
          if (Date.now() >= deadline) throw new Error("cancelled turn event was not observed");
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        console.log("PASS turn.cancel: cancellation completed safely");
      } finally {
        unsubscribe();
      }
    } else {
      assert(recovered.state === "idle", `runtime restart state was ${recovered.state}`);
      assert(!history.turns.some((turn) => turn.turnId === interruptedTurnId), "unexpected unauthenticated turn persisted");
      console.log("PASS runtime.restart/session.attach: session recovered");
      console.log("SKIP interrupted turn recovery: trusted credential not present");
    }
  } finally {
    await restartedClient?.shutdown();
    restartedClient?.forceKill();
    await client.shutdown();
    client.forceKill();
    await FS.rm(root, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  await main().catch((error: unknown) => {
    console.error(`FAIL PortLog product proof: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
