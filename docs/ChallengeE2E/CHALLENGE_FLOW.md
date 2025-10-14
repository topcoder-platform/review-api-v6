## Description

This document will describe how to create a challenge, assign a submitter and a reviewer, activate the challenge, add a submission, add a review, add an appeal, add an appeals response, and move the challenge through all necessary challenge phases, via the API.

The goal here is to allow us to quickly and easily get a challenge to a specific phase and state for QA and testing purposes.

## Prerequisites

You'll need the member ID of:

* Submitter
* Reviewer

You can easily get the ID values of a member, given their handle, from `https://api.topcoder-dev.com/v6/members/{handle}`

You'll need an active project ID of a project with an active billing account.  
You'll need the:

* Challenge type ID
    * From: https://api.topcoder-dev.com/v6/challenge-types
* Challenge track ID
    * From: https://api.topcoder-dev.com/v6/challenge-tracks
* Timeline template ID
    * From: https://api.topcoder-dev.com/v6/timeline-templates
* Resource role ID of a submitter
    * From: https://api.topcoder-dev.com/v6/resource-roles
* Resource role ID of a reviewer
    * From: https://api.topcoder-dev.com/v6/resource-roles

You'll also need an M2M token that has read and write access to the appropriate APIs.  You can ask Justin for a `curl` request that will generate one for you.

`$NOW` can be the current ISO-8601 timestamp, like `2025-09-07T00:15:00Z`.  We use the current timestamp when launching the challenge so that it launches immediately after 

## Create a challenge

**NOTE** Below is the required API call, but this can also be done via the v6 work manager, currently at https://challenges-v6.topcoder-dev.com.

**API call:** `POST https://api.topcoder-dev.com/v6/challenges`

**Sample:**

```
curl -X POST "https://api.topcoder-dev.com/v6/challenges" \
  -H "Authorization: Bearer $M2M_TOKEN" -H "Content-Type: application/json" \
  -d '{
    "name": "Demo Challenge – instant launch",
    "typeId": "927abff4-7af9-4145-8ba1-577c16e64e2e",           // Challenge
    "trackId": "9b6fc876-f4d9-4ccb-9dfd-419247628825",          // Development
    "timelineTemplateId": "7ebf1c69-f62f-4d3a-bdfb-fe9ddb56861c",  // Default challenge timeline
    "status": "NEW",
    "prizes": [{ "type": "USD", "value": 300 }],
    "metadata": { "autoCreateForum": false },
    "description": "End-to-end test"
  }'
```

**Validation:** `curl "https://api.topcoder-dev.com/v6/challenges/{challengeId}"`

## Move NEW --> DRAFT


**API call:** `PATCH https://api.topcoder-dev.com/v6/challenges/{challengeId}`

**Sample:**

```
curl -X PATCH "https://api.topcoder-dev.com/v6/challenges/{challengeId}" \
  -H "Authorization: Bearer $M2M_TOKEN" -H "Content-Type: application/json" \
  -d '{
    "typeId": "927abff4-7af9-4145-8ba1-577c16e64e2e",
    "trackId": "9b6fc876-f4d9-4ccb-9dfd-419247628825",
    "name": "Demo Challenge - instant launch",
    "description": "End-to-end test",
    "tags": [],
    "groups": [],
    "metadata": [],
    "startDate": "2025-09-07T03:50:39.031Z",
    "prizeSets": [
        {
            "type": "PLACEMENT",
            "prizes": [
                {
                    "type": "USD",
                    "value": 1
                }
            ]
        }
    ],
    "winners": [],
    "discussions": [],
    "task": {
        "isTask": false,
        "isAssigned": false
    },
    "skills": [
        {
            "name": "Java",
            "id": "63bb7cfc-b0d4-4584-820a-18c503b4b0fe"
        }
    ],
    "legacy": {
        "reviewType": "COMMUNITY",
        "confidentialityType": "public",
        "directProjectId": 33540,
        "isTask": false,
        "useSchedulingAPI": false,
        "pureV5Task": false,
        "pureV5": false,
        "selfService": false
    },
    "timelineTemplateId": "7ebf1c69-f62f-4d3a-bdfb-fe9ddb56861c",
    "projectId": "100439",
    "status": "DRAFT",
    "attachmentIds": []
}'
```
**Validation:** `curl "https://api.topcoder-dev.com/v6/challenges/{challengeId}"`

## Move DRAFT → ACTIVE (triggers Autopilot to open phases)

**API call:** `PATCH https://api.topcoder-dev.com/v6/challenges/{challengeId}`

**Sample:**

```
curl -X PATCH "https://api.topcoder-dev.com/v6/challenges/{challengeId}" \
  -H "Authorization: Bearer $M2M_TOKEN" -H "Content-Type: application/json" \
  -d '{ "status": "ACTIVE" }'
```

**Validation:** 

* `curl "https://api.topcoder-dev.com/v6/challenges/{challengeId}"`


## Get the challenge object and note the phases

**API call:** `GET https://api.topcoder-dev.com/v6/challenges/{challengeId}`

**Sample:**

```
curl "https://api.topcoder-dev.com/v6/challenges/{challengeId}" \
  -H "Authorization: Bearer $M2M_TOKEN" -H "Content-Type: application/json" \
```

## Manually open Registration/Submission (only if needed ie: autopilot doesn't open these)


**API call:** `PATCH https://api.topcoder-dev.com/v6/challenges/{challengeId}/phases/{phaseId}`

**Sample:**

```
curl -X PATCH "https://api.topcoder-dev.com/v6/challenges/{challengeId}/" \
  -H "Authorization: Bearer $M2M_TOKEN" -H "Content-Type: application/json" \
  -d '{ "isOpen": true }'
```

**Validation:** `curl "https://api.topcoder-dev.com/v6/challenges/{challengeId}/phases"`

## Add a submitter to the challenge:

**API call:** `POST https://api.topcoder-dev.com/v6/resources`

**Sample:**

```
curl -X POST "https://api.topcoder-dev.com/v6/resources" \
  -H "Authorization: Bearer $M2M_TOKEN" -H "Content-Type: application/json" \
  -d '{
    "challengeId": "{challengeId}",
    "memberId":    "{submitterMemberId}",
    "roleId":      "732339e7-8e30-49d7-9198-cccf9451e221"   // role for "Submitter" in dev
  }'
```

**Validation:** `curl "https://api.topcoder-dev.com/v6/resources?challengeId={challengeId}"`

## Add a reviewer to the challenge:

**API call:** `POST https://api.topcoder-dev.com/v6/resources`

**Sample:**

```
curl -X POST "https://api.topcoder-dev.com/v6/resources" \
  -H "Authorization: Bearer $M2M_TOKEN" -H "Content-Type: application/json" \
  -d '{
    "challengeId": "{challengeId}",
    "memberId":    "{reviewerMemberId}",
    "roleId":      "318b9c07-079a-42d9-a81f-b96be1dc1099"   // role for "Reviewer" in dev
  }'
```

**Validation:** `curl "https://api.topcoder-dev.com/v6/resources?challengeId={challengeId}"`

## Create a submission for the submitter

**API call:** `POST https://api.topcoder-dev.com/v6/submissions`

**Sample:**

```
curl -X POST "https://api.topcoder-dev.com/v6/submissions" \
  -H "Authorization: Bearer $M2M_TOKEN" -H "Content-Type: application/json" \
  -d '{
    "challengeId": "{challengeId}",
    "memberId":    "{submitterMemberId}",
    "type":        "CONTEST_SUBMISSION",
    "url":         "https://example.com/artifacts/submission.zip"
     }'
```

**Validation:** 

* `curl "https://api.topcoder-dev.com/v6/submissions?challengeId={challengeId}"`
* `curl "https://api.topcoder-dev.com/v6/submissions?challengeId={challengeId}&memberId={submitterMemberId}"`

## Close Registration & Submission; open Review phase

If Autopilot hasn’t moved the phases yet (e.g., you want to force an immediate transition):


**API calls:** 

* Get the phase IDs: `GET https://api.topcoder-dev.com/v6/challenges/{challengeId}/phases`
* Update the phase: `PATCH https://api.topcoder-dev.com/v6/challenges/{challengeId}/phases/{specificPhaseId}`

**Sample:**

```
# Close Registration
curl -X PATCH "https://api.topcoder-dev.com/v6/challenges/{challengeId}/phases/{registrationPhaseId}" \
  -H "Authorization: Bearer $M2M_TOKEN" -H "Content-Type: application/json" \
  -d '{ "isOpen":false }'

# Close Submission
curl -X PATCH "https://api.topcoder-dev.com/v6/challenges/{challengeId}/phases/{submissionPhaseId}" \
  -H "Authorization: Bearer $M2M_TOKEN" -H "Content-Type: application/json" \
  -d '{ "isOpen":false }'

# Open Review
curl -X PATCH "https://api.topcoder-dev.com/v6/challenges/{challengeId}/phases/{reviewPhaseId}" \
  -H "Authorization: Bearer $M2M_TOKEN" -H "Content-Type: application/json" \
  -d '{ "isOpen":true }'
```

**Validation:** `curl "https://api.topcoder-dev.com/v6/challenges/{challengeId}/phases"`

## Create a review for the submission from the reviewer

**API Call:** `POST /v6/reviews`

**Sample:**

```
curl -X POST "https://api.topcoder-dev.com/v6/reviews" \
  -H "Authorization: Bearer $M2M_TOKEN" -H "Content-Type: application/json" \
  -d '{
  "resourceId": "{{reviewerResourceId}}",
  "phaseId": "{{reviewPhaseId}}",
  "submissionId": "{{submissionId}}",
  "scorecardId": "{{scorecardId}}",
  "finalScore": 85.5,
  "initialScore": 80,
  "typeId": "REVIEW",
  "metadata": {},
  "status": "Review",
  "reviewDate": "2025-09-07T00:00:00Z",
  "committed": true,
  "reviewItems": [
    {
      "scorecardQuestionId": "qJ1Xd5JgJ2I6CX",
      "initialAnswer": "9",
      "reviewItemComments": [
        {
          "content": "This is the content for question 1",
          "type": "COMMENT",
          "sortOrder": 1
        }
      ]
    },
    {
      "scorecardQuestionId": "GxN_O7CEC1pUXX",
      "initialAnswer": "YES",
      "reviewItemComments": [
        {
          "content": "This is the content for question 2",
          "type": "COMMENT",
          "sortOrder": 1
        }
      ]
    },
    {
      "scorecardQuestionId": "hCTsnzWo-b8g95",
      "initialAnswer": "8",
      "reviewItemComments": [
        {
          "content": "This is the content for question 3",
          "type": "COMMENT",
          "sortOrder": 1
        }
      ]
    },
    {
      "scorecardQuestionId": "I9OwPABNbpI3ln",
      "initialAnswer": "8",
      "reviewItemComments": [
        {
          "content": "This is the content for question 4",
          "type": "COMMENT",
          "sortOrder": 1
        }
      ]
    },
    {
      "scorecardQuestionId": "gAbkFpjXMG9uP7",
      "initialAnswer": "7",
      "reviewItemComments": [
        {
          "content": "This is the content for question 5",
          "type": "COMMENT",
          "sortOrder": 1
        }
      ]
    },
    {
      "scorecardQuestionId": "_iSocUwSL87wR7",
      "initialAnswer": "9",
      "reviewItemComments": [
        {
          "content": "This is the content for question 6",
          "type": "COMMENT",
          "sortOrder": 1
        }
      ]
    },
    {
      "scorecardQuestionId": "axmCtzQa3w0Jjt",
      "initialAnswer": "YES",
      "reviewItemComments": [
        {
          "content": "This is the content for question 6",
          "type": "COMMENT",
          "sortOrder": 1
        }
      ]
    },
    {
      "scorecardQuestionId": "zVZTmkNESYDwbe",
      "initialAnswer": "9",
      "reviewItemComments": [
        {
          "content": "This is the content for question 7",
          "type": "COMMENT",
          "sortOrder": 1
        }
      ]
    },
    {
      "scorecardQuestionId": "hvtNBqdaWzX3vH",
      "initialAnswer": "YES",
      "reviewItemComments": [
        {
          "content": "This is the content for question 8",
          "type": "COMMENT",
          "sortOrder": 1
        }
      ]
    },
    {
      "scorecardQuestionId": "oEMhxCBzFrxlgb",
      "initialAnswer": "8",
      "reviewItemComments": [
        {
          "content": "This is the content for question 9",
          "type": "COMMENT",
          "sortOrder": 1
        }
      ]
    },
    {
      "scorecardQuestionId": "T0toPXe65Z80Y-",
      "initialAnswer": "9",
      "reviewItemComments": [
        {
          "content": "This is the content for question 10",
          "type": "COMMENT",
          "sortOrder": 1
        }
      ]
    }
  ]
}'
```

**Validation:** `curl "https://api.topcoder-dev.com/v6/reviews/{reviewId}"`

## Close the review phase; open appeals

**API Call:** `PATCH /v6/challenges/{challengeId}/phases/{specificPhaseID}`

**Sample:**

```
# Close Review
curl -X PATCH "https://api.topcoder-dev.com/v6/challenges/{challengeId}/phases/{reviewPhaseId}" \
  -H "Authorization: Bearer $M2M_TOKEN" -H "Content-Type: application/json" \
  -d '{ "isOpen":false }'

# Open Appeals
curl -X PATCH "https://api.topcoder-dev.com/v6/challenges/{challengeId}/phases/{appealsPhaseId}" \
  -H "Authorization: Bearer $M2M_TOKEN" -H "Content-Type: application/json" \
  -d '{ "isOpen":true }'
```

**Validation:** `curl "https://api.topcoder-dev.com/v6/challenges/{challengeId}/phases"`

## Create an appeal from the submitter

**API call:** `POST /v6/appeals`

**Sample:**

```
curl -X POST "https://api.topcoder-dev.com/v6/appeals" \
  -H "Authorization: Bearer $M2M_TOKEN" -H "Content-Type: application/json" \
  -d '{
  "resourceId": {{reviewerResourceId}},
  "reviewItemCommentId": {{reviewItemCommentId}},
  "content": "This is my appeal."
  }'
```

**Validation:** `curl "https://api.topcoder-dev.com/v6/appeals?challengeId={challengeId}&submissionId={submissionId}"`


## Close appeals, open appeals response

**API call:** `PATCH /v6/challenges/{challengeId}/phases/{specificPhaseId}`

**Sample:**

```
# Close Appeals
curl -X PATCH "https://api.topcoder-dev.com/v6/challenges/{challengeId}/phases/{appealsPhaseId}" \
  -H "Authorization: Bearer $M2M_TOKEN" -H "Content-Type: application/json" \
  -d '{ "isOpen":false }'

# Open Appeals Response
curl -X PATCH "https://api.topcoder-dev.com/v6/challenges/{challengeId}/phases/{appealsResponsePhaseId}" \
  -H "Authorization: Bearer $M2M_TOKEN" -H "Content-Type: application/json" \
  -d '{ "isOpen":true }'
```

**Validation:** `curl "https://api.topcoder-dev.com/v6/challenges/{challengeId}/phases"`

## Create an appeals response from the reviewer

**API Call:** `POST /v6/appeals-responses`

**Sample:**

```
curl -X POST "https://api.topcoder-dev.com/v6/appeal-responses" \
  -H "Authorization: Bearer $M2M_TOKEN" -H "Content-Type: application/json" \
  -d '{
  "appealId": "{{appealId}}",
  "resourceId": "{{submitterResourceId}}",
  "content": "This is the content of the appeal response that indicates the appeal was successful.",
  "success": true
  }'
```

**Validation:** `curl "https://api.topcoder-dev.com/v6/appeal-responses?appealId={appealId}"`

## Close appeals response phase

**API call:** `PATCH /v6/challenges/{challengeId}/phases/{specificPhaseId}`

**Sample:**

```
# Close Appeals Response
curl -X PATCH "https://api.topcoder-dev.com/v6/challenges/{challengeId}/phases/{appealsResponsePhaseId}" \
  -H "Authorization: Bearer $M2M_TOKEN" -H "Content-Type: application/json" \
  -d '{ "isOpen":false }'
```

**Validation:** `curl "https://api.topcoder-dev.com/v6/challenges/{challengeId}/phases"`

## Move challenge to completed (if not done by autopilot)

**API Call:** `PATCH /v6/challenges/{challengeId}`

**Sample:**

```
curl -X PATCH "https://api.topcoder-dev.com/v6/challenges/{challengeId}" \
  -H "Authorization: Bearer $M2M_TOKEN" -H "Content-Type: application/json" \
  -d '{ "status": "COMPLETED" }'
```

**Validation:** `curl "https://api.topcoder-dev.com/v6/challenges/{challengeId}"`