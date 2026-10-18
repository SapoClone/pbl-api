#!/usr/bin/env node
// Moves the messages of a service's dead-letter queue back to its queue, so they
// are processed again once the cause is fixed (ADR-0007).
//   node scripts/redrive-dlq.js <service> [--max <n>]
// Uses only the SQS API, so it works on ElasticMQ (AWS_ENDPOINT_URL_SQS) and on AWS.
const {
  DeleteMessageCommand,
  GetQueueUrlCommand,
  ReceiveMessageCommand,
  SQSClient,
  SendMessageCommand,
} = require('@aws-sdk/client-sqs');

const queueName = (service) => `${service}-events`;
const dlqName = (service) => `${service}-events-dlq`;

/** Returns how many messages were moved */
async function redrive({ sqs, service, max = Infinity }) {
  const url = async (name) =>
    (await sqs.send(new GetQueueUrlCommand({ QueueName: name }))).QueueUrl;
  const queueUrl = await url(queueName(service));
  const dlqUrl = await url(dlqName(service));

  let moved = 0;
  while (moved < max) {
    const { Messages = [] } = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: dlqUrl,
        MaxNumberOfMessages: Math.min(10, max - moved),
        WaitTimeSeconds: 1,
        MessageAttributeNames: ['All'],
      }),
    );
    if (Messages.length === 0) break;
    for (const message of Messages) {
      // send first, delete after: a crash in between duplicates, never loses
      await sqs.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: message.Body,
          MessageAttributes: message.MessageAttributes,
        }),
      );
      await sqs.send(
        new DeleteMessageCommand({
          QueueUrl: dlqUrl,
          ReceiptHandle: message.ReceiptHandle,
        }),
      );
      moved += 1;
    }
  }
  return moved;
}

module.exports = { redrive };

if (require.main === module) {
  const args = process.argv.slice(2);
  const service = args.find((a) => !a.startsWith('--'));
  const maxIndex = args.indexOf('--max');
  const max = maxIndex >= 0 ? Number(args[maxIndex + 1]) : Infinity;
  if (!service || Number.isNaN(max)) {
    console.error('usage: node scripts/redrive-dlq.js <service> [--max <n>]');
    process.exit(1);
  }
  const sqs = new SQSClient({
    region: process.env.AWS_REGION || 'ap-southeast-1',
  });
  redrive({ sqs, service, max })
    .then((moved) =>
      console.log(
        `Moved ${moved} message(s) from ${dlqName(service)} to ${queueName(service)}`,
      ),
    )
    .catch((error) => {
      console.error(`redrive failed: ${error.message}`);
      process.exit(1);
    });
}
