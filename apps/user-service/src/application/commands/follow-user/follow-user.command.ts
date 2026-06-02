export class FollowUserCommand {
  constructor(
    public readonly followerId: string,
    public readonly followeeId: string,
  ) {}
}

export class UnfollowUserCommand {
  constructor(
    public readonly followerId: string,
    public readonly followeeId: string,
  ) {}
}
