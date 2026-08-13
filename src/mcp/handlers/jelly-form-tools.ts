import type { WordPressClient } from "../../lib/wp-client.js";

/** Jelly Form 询价列表工具的输入参数。 */
export interface JellyFormInquiryListInput {
  /** 模糊搜索提交内容、页面标题或国家。 */
  search?: string;
  /** 从 1 开始的页码。 */
  page?: number;
  /** 每页记录数。 */
  perPage?: number;
  /** 起始日期，格式为 YYYY-MM-DD。 */
  startDate?: string;
  /** 结束日期，格式为 YYYY-MM-DD。 */
  endDate?: string;
  /** 排序字段。 */
  orderBy?: "id" | "created_at" | "page_title" | "country";
  /** 排序方向。 */
  order?: "ASC" | "DESC";
}

/** Jelly Form 单条询价工具的输入参数。 */
export interface JellyFormInquiryGetInput {
  /** 询价记录 ID。 */
  id: number;
}

/** Jelly Form SMTP 更新对象。 */
export interface JellyFormSmtpInput {
  /** SMTP 主机名。 */
  host?: string;
  /** SMTP 端口。 */
  port?: number;
  /** SMTP 加密方式。 */
  encryption?: "none" | "ssl" | "tls";
  /** SMTP 登录用户名。 */
  username?: string;
  /** 新 SMTP 密码；省略或留空时保留旧密码。 */
  password?: string;
  /** 是否明确清除已保存的 SMTP 密码。 */
  clearPassword?: boolean;
  /** 发件邮箱。 */
  fromEmail?: string;
  /** 发件人名称。 */
  fromName?: string;
}

/** Jelly Form 设置更新工具的输入参数。 */
export interface JellyFormSettingsUpdateInput {
  /** 接收询价通知的邮箱。 */
  recipientEmail?: string;
  /** 是否发送询价通知邮件。 */
  emailEnabled?: boolean;
  /** 是否启用前端弹窗。 */
  popupEnabled?: boolean;
  /** IPInfo 服务令牌。 */
  ipinfoToken?: string;
  /** 提交成功后的跳转路径；空字符串表示禁用跳转。 */
  redirectSlug?: string;
  /** 是否启用自定义 SMTP。 */
  smtpEnabled?: boolean;
  /** 要更新的 SMTP 字段。 */
  smtp?: JellyFormSmtpInput;
}

/** 读取 Jelly Form 邮件和 SMTP 设置，密码仅返回是否已设置。 */
export async function getJellyFormSettings(client: WordPressClient): Promise<unknown> {
  const result = await client.requestApiPath("jelly-form/v1/settings");
  return result.data;
}

/** 更新 Jelly Form 邮件和 SMTP 设置，并返回更新后的脱敏设置。 */
export async function updateJellyFormSettings(
  client: WordPressClient,
  input: JellyFormSettingsUpdateInput
): Promise<unknown> {
  const smtp = input.smtp === undefined ? undefined : {
    host: input.smtp.host,
    port: input.smtp.port,
    encryption: input.smtp.encryption,
    username: input.smtp.username,
    password: input.smtp.password,
    clear_password: input.smtp.clearPassword,
    from_email: input.smtp.fromEmail,
    from_name: input.smtp.fromName
  };
  const body = Object.fromEntries(Object.entries({
    recipient_email: input.recipientEmail,
    email_enabled: input.emailEnabled,
    popup_enabled: input.popupEnabled,
    ipinfo_token: input.ipinfoToken,
    redirect_slug: input.redirectSlug,
    smtp_enabled: input.smtpEnabled,
    smtp: smtp === undefined ? undefined : Object.fromEntries(Object.entries(smtp).filter(([, value]) => value !== undefined))
  }).filter(([, value]) => value !== undefined));

  const result = await client.requestApiPath("jelly-form/v1/settings", { method: "POST", body });
  return result.data;
}

/** 分页读取 Jelly Form 非垃圾询价记录。 */
export async function listJellyFormInquiries(
  client: WordPressClient,
  input: JellyFormInquiryListInput
): Promise<unknown> {
  const result = await client.requestApiPath("jelly-form/v1/inquiries", {
    query: {
      search: input.search,
      page: input.page,
      per_page: input.perPage,
      start_date: input.startDate,
      end_date: input.endDate,
      orderby: input.orderBy,
      order: input.order
    }
  });
  return result.data;
}

/** 按 ID 读取一条 Jelly Form 非垃圾询价记录。 */
export async function getJellyFormInquiry(
  client: WordPressClient,
  input: JellyFormInquiryGetInput
): Promise<unknown> {
  const result = await client.requestApiPath(`jelly-form/v1/inquiries/${input.id}`);
  return result.data;
}
