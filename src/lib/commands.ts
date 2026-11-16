export type Command = {
  id: string;
  title: string;
  category?: string;
  keywords?: string[];
  when?: () => boolean;
  run: () => void | Promise<void>;
};

const commands = new Map<string, Command>();

export function registerCommand(command: Command): () => void {
  commands.set(command.id, command);
  return () => {
    if (commands.get(command.id) === command) commands.delete(command.id);
  };
}

export function unregisterCommand(id: string): void {
  commands.delete(id);
}

export function listCommands(): Command[] {
  return [...commands.values()]
    .filter((command) => !command.when || command.when())
    .sort((left, right) => left.title.localeCompare(right.title));
}

export function findCommands(query: string): Command[] {
  const normalized = query.trim().toLowerCase();
  const matches = listCommands();
  if (!normalized) return matches;
  return matches.filter((command) =>
    [command.title, command.category, ...(command.keywords ?? [])]
      .filter((value): value is string => Boolean(value))
      .join(" ")
      .toLowerCase()
      .includes(normalized),
  );
}

export async function executeCommand(id: string): Promise<void> {
  const command = commands.get(id);
  if (!command) throw new Error(`Unknown command: ${id}`);
  if (command.when && !command.when()) return;
  await command.run();
}