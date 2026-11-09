#!/usr/bin/env python3
"""Configure the existing dev buckets and Review API for Uppy. Requires boto3.

Run with AWS dev credentials in the environment. Does not deploy a task or rotate
an existing signing key. The normal deployment must inject these SSM parameters.
"""
import json
import secrets
import boto3
from botocore.config import Config

ACCOUNT = '811668436784'
REGION = 'us-east-1'
PARAMETER_PREFIX = '/config/review-api-v6/appvar/'
SETTINGS = {
    'UPLOAD_ATTACHMENT_BUCKET': 'tc-challenge-v5-dev',
    'UPLOAD_FORUM_BUCKET': 'tc-challenge-v5-dev',
    'UPLOAD_PROJECT_BUCKET': 'submission-staging-dev',
    'UPLOAD_SHOWCASE_BUCKET': 'topcoder-dev-showcase-media',
    'UPLOAD_SHOWCASE_CDN_URL': 'https://showcase-media.topcoder-dev.com',
    'UPLOAD_PUBLIC_API_URL': 'https://api.topcoder-dev.com/v6/reviews/uploads',
}
ORIGINS = [
    'https://platform-ui.topcoder-dev.com', 'https://platform-ui-v6.topcoder-dev.com', 'https://www.topcoder-dev.com',
    'https://platform.topcoder-dev.com', 'https://local.topcoder-dev.com',
    'http://localhost:3000', 'http://127.0.0.1:9876',
]


def configure():
    session = boto3.Session(region_name=REGION)
    config = Config(retries={'max_attempts': 5, 'mode': 'adaptive'})
    sts = session.client('sts', endpoint_url=f'https://sts.{REGION}.amazonaws.com', config=config)
    if sts.get_caller_identity()['Account'] != ACCOUNT:
        raise RuntimeError('This script only configures the AWS dev account.')
    ssm = session.client('ssm', config=config)
    for name, value in SETTINGS.items():
        ssm.put_parameter(Name=PARAMETER_PREFIX + name, Value=value, Type='SecureString', Overwrite=True)
    try:
        ssm.get_parameter(Name=PARAMETER_PREFIX + 'UPLOAD_SIGNING_SECRET')
    except ssm.exceptions.ParameterNotFound:
        ssm.put_parameter(Name=PARAMETER_PREFIX + 'UPLOAD_SIGNING_SECRET',
                          Value=secrets.token_hex(32), Type='SecureString', Overwrite=False)
    session.client('iam', config=config).put_role_policy(
        RoleName='topcoder-submissions-role', PolicyName='uppy-attachment-uploads',
        PolicyDocument=json.dumps({'Version': '2012-10-17', 'Statement': [{
            'Effect': 'Allow',
            'Action': ['s3:PutObject', 's3:GetObject', 's3:AbortMultipartUpload', 's3:ListMultipartUploadParts'],
            'Resource': [
                'arn:aws:s3:::tc-challenge-v5-dev/uppy/*',
                'arn:aws:s3:::submission-staging-dev/PROJECT_ATTACHMENTS/*',
                'arn:aws:s3:::topcoder-dev-showcase-media/project-showcase/*',
            ],
        }]}),
    )
    s3 = session.client('s3', config=config)
    buckets = set(SETTINGS[name] for name in SETTINGS if name.endswith('_BUCKET'))
    buckets.add('topcoder-dev-submissions-dmz')
    for bucket in sorted(buckets):
        try:
            rules = s3.get_bucket_cors(Bucket=bucket)['CORSRules']
        except s3.exceptions.ClientError as error:
            if error.response['Error']['Code'] != 'NoSuchCORSConfiguration':
                raise
            rules = []
        rules = [rule for rule in rules if rule.get('ID') != 'Uppy6Dev']
        rules.append({'ID': 'Uppy6Dev', 'AllowedOrigins': ORIGINS,
                      'AllowedMethods': ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'],
                      'AllowedHeaders': ['*'], 'ExposeHeaders': ['ETag', 'Location'], 'MaxAgeSeconds': 3000})
        s3.put_bucket_cors(Bucket=bucket, CORSConfiguration={'CORSRules': rules})
    print('Configured dev SSM settings, upload role policy and S3 CORS. No signing key values were printed.')


if __name__ == '__main__':
    configure()
