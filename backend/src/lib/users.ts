/** 演示用轻量身份（x-user-id 头）。生产应替换为会话/JWT。 */
export interface UserIdentity {
  id: string;
  name: string;
  color: string;
}

export const USERS: Record<string, UserIdentity> = {
  "u-jia": { id: "u-jia", name: "甲", color: "#6366f1" },
  "u-yi": { id: "u-yi", name: "乙", color: "#f59e0b" },
  "u-bing": { id: "u-bing", name: "丙", color: "#10b981" },
};

export function userFromHeader(id: string | undefined): UserIdentity {
  if (id && USERS[id]) return USERS[id];
  return USERS["u-jia"];
}
