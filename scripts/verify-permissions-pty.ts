import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const providerExtension = join(root, "test/fixtures/btw-pty-provider.ts");
const triggerExtension = join(root, "test/permissions/fixtures/permissions-pty-trigger.ts");
const runner = join(root, "test/permissions/fixtures/permissions-pty-runner.sh");

export interface PermissionsPtyVerificationOptions {
	readonly piBinary: string;
	readonly packagePath: string;
	readonly columns: number;
	readonly rows: number;
}

function expectProgram(): string {
	return `
set timeout 20

proc must_expect {pattern} {
    expect {
        -exact $pattern {}
        timeout {
            puts stderr "Timed out waiting for: $pattern"
            exit 2
        }
        eof {
            puts stderr "Reached EOF while waiting for: $pattern"
            exit 3
        }
    }
}

spawn -noecho script -qefc $env(PI_STUFF_PTY_RUNNER) /dev/null
must_expect "fixture-model"
after 100
send -- "DRAFT_RESTORED"
send -- "\\033\\[23~"
must_expect "Bash command"
must_expect "Allow this exact call once"
must_expect "Deny"
send -- "\\033\\[6~"
must_expect "target-10"
send -- "y"
must_expect "PERMISSION_PTY:approved:DRAFT_RESTORED"
send -- "\\003"
after 200
send -- "\\004"
expect {
    eof {}
    timeout {
        puts stderr "Timed out waiting for Pi to exit"
        exit 4
    }
}
`;
}

function fail(message: string): never {
	throw new Error(`Permissions PTY verification failed: ${message}`);
}

export async function verifyPermissionsPty(options: PermissionsPtyVerificationOptions): Promise<void> {
	const temporaryDirectory = await mkdtemp(join(tmpdir(), "pi-stuff-permissions-pty-"));
	const configDirectory = join(temporaryDirectory, "config");
	const sessionDirectory = join(temporaryDirectory, "sessions");
	await Promise.all([mkdir(configDirectory), mkdir(sessionDirectory)]);

	try {
		const result = Bun.spawnSync(["expect", "-c", expectProgram()], {
			cwd: root,
			env: {
				...process.env,
				PI_CODING_AGENT_DIR: configDirectory,
				PI_STUFF_PTY_BIN: options.piBinary,
				PI_STUFF_PTY_COLUMNS: String(options.columns),
				PI_STUFF_PTY_PACKAGE: resolve(options.packagePath),
				PI_STUFF_PTY_PROVIDER_EXTENSION: providerExtension,
				PI_STUFF_PTY_ROWS: String(options.rows),
				PI_STUFF_PTY_RUNNER: runner,
				PI_STUFF_PTY_SESSIONS: sessionDirectory,
				PI_STUFF_PTY_SESSION_ID: `permissions-pty-${options.columns}x${options.rows}`,
				PI_STUFF_PTY_TRIGGER_EXTENSION: triggerExtension,
				TERM: "xterm-256color",
			},
			stdout: "pipe",
			stderr: "pipe",
		});
		if (result.exitCode !== 0) {
			fail(
				[result.stderr.toString().trim(), result.stdout.toString().trim(), `expect exited ${result.exitCode}`]
					.filter(Boolean)
					.join("\n"),
			);
		}
	} finally {
		await rm(temporaryDirectory, { recursive: true, force: true });
	}
}

if (import.meta.main) {
	const { PI_BIN = "/opt/pi-coding-agent/pi" } = process.env;
	for (const [columns, rows] of [
		[100, 32],
		[64, 28],
	] as const) {
		await verifyPermissionsPty({ piBinary: PI_BIN, packagePath: join(root, "packages/pi-stuff"), columns, rows });
	}
	console.log("Certified Permissions in 100x32 and 64x28 PTYs");
}
