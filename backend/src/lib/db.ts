import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { env } from "./env";

const client = new DynamoDBClient({});
export const ddb = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

export interface User {
  email: string;
  userId: string;
  passwordHash: string;
  createdAt: string;
}

export async function getUserByEmail(email: string): Promise<User | undefined> {
  const res = await ddb.send(
    new GetCommand({ TableName: env.usersTable, Key: { email } })
  );
  return res.Item as User | undefined;
}

export async function createUser(user: User): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: env.usersTable,
      Item: user,
      ConditionExpression: "attribute_not_exists(email)",
    })
  );
}

export type ApplicationStatus = "recibida";

export interface Application {
  userId: string;
  // Sort key: `${createdAt}#${applicationId}` so Query returns applications in
  // chronological order for free, while applicationId keeps the item unique.
  sk: string;
  applicationId: string;
  fullName: string;
  documentId: string;
  institution: string;
  program: string;
  amount: number;
  videoKey: string;
  status: ApplicationStatus;
  createdAt: string;
}

export async function createApplication(app: Application): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: env.applicationsTable,
      Item: app,
      ConditionExpression: "attribute_not_exists(sk)",
    })
  );
}

export async function listApplicationsByUser(userId: string): Promise<Application[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: env.applicationsTable,
      KeyConditionExpression: "userId = :userId",
      ExpressionAttributeValues: { ":userId": userId },
      ScanIndexForward: false,
    })
  );
  return (res.Items ?? []) as Application[];
}
