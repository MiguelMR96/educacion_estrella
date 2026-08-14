function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const env = {
  get usersTable() {
    return required("USERS_TABLE");
  },
  get applicationsTable() {
    return required("APPLICATIONS_TABLE");
  },
  get videosBucket() {
    return required("VIDEOS_BUCKET");
  },
  get jwtSecret() {
    return required("JWT_SECRET");
  },
  get corsOrigin() {
    return required("CORS_ORIGIN");
  },
};
