// Save original env
const originalEnv = process.env;

beforeEach(() => {
  jest.resetModules();
  process.env = { ...originalEnv };
});

afterAll(() => {
  process.env = originalEnv;
});

describe('emailService - sendEmail', () => {

  test('calls SMTP provider by default', async () => {
    process.env.EMAIL_PROVIDER = 'smtp';
    const nodemailer = require('nodemailer');
    const mockSendMail = jest.fn().mockResolvedValue({});
    jest.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail: mockSendMail });

    const { sendEmail } = require('xeplr-utils');
    await sendEmail('to@test.com', 'Subject', '<p>Hello</p>');

    expect(nodemailer.createTransport).toHaveBeenCalled();
    expect(mockSendMail).toHaveBeenCalledWith({
      from: process.env.SMTP_FROM,
      to: 'to@test.com',
      subject: 'Subject',
      html: '<p>Hello</p>',
    });
  });

  test('calls Brevo provider when configured', async () => {
    process.env.EMAIL_PROVIDER = 'brevo';
    process.env.BREVO_API_KEY = 'test-api-key';
    process.env.BREVO_FROM_EMAIL = 'sender@test.com';
    process.env.BREVO_FROM_NAME = 'TestApp';

    const mockFetch = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = mockFetch;

    const { sendEmail } = require('xeplr-utils');
    await sendEmail('to@test.com', 'Subject', '<p>Hello</p>');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.brevo.com/v3/smtp/email',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'api-key': 'test-api-key',
        }),
      })
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.sender.email).toBe('sender@test.com');
    expect(body.sender.name).toBe('TestApp');
    expect(body.to[0].email).toBe('to@test.com');
    expect(body.subject).toBe('Subject');
    expect(body.htmlContent).toBe('<p>Hello</p>');

    delete global.fetch;
  });

  test('throws error for unknown provider', async () => {
    process.env.EMAIL_PROVIDER = 'unknown';

    const { sendEmail } = require('xeplr-utils');
    await expect(sendEmail('to@test.com', 'Sub', '<p>Hi</p>'))
      .rejects.toThrow('Unknown email provider: unknown');
  });

});
