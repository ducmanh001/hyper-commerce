export class UpdateProfileCommand {
  constructor(
    public readonly userId: string,      // The user being updated
    public readonly requesterId: string, // Who is making the request (auth check)
    public readonly changes: {
      displayName?: string;
      bio?:         string;
      avatarUrl?:   string;
    },
  ) {}
}
