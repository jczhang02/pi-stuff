# Use TypeScript and Bun

The maintainer selected TypeScript and Bun for Pi Stuff. Use the same toolchain for repository automation instead of maintaining a separate Python environment: Bun runs scripts and tests, installs dependencies from `bun.lock`, and invokes TypeScript for static checking. This replaces the bootstrap Python checkers without changing their PR evidence or security requirements.

Bun's ability to execute TypeScript does not replace type checking. CI runs both the compiler and tests. This choice does not certify compatibility with a particular Pi host version; verify that separately when executable extensions are introduced.
