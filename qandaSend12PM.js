'use latest'; // eslint-disable-line
import Twilio from 'twilio'
import moment from 'moment-timezone'
import {GraphQLClient} from 'graphql-request'

// const todayObject = moment()
// const today = todayObject.tz('America/Denver').format('MM/DD')

// /* GRAPHQL REQUESTS */
// const getMessageData = `{
// 	allUsers {
// 		phone
// 		firstName
// 	}
// 	Question(dateToAsk: "${today}") {
// 		text
// 	}
// }`

const createQuestion = date => (`{
	createQuestion(
    dateToAsk: "${date}"
    text: "This is a test question."
  ) {
    id
  }
}`)

export default (context, cb) => {
	/* ACCOUNT SECRETS */
	const {
		TWILIO_ACCT_SID,
		TWILIO_AUTH_TOKEN,
		TWILIO_PHONE,
		GRAPHCOOL_SIMPLE_API_END_POINT,
		GRAPHCOOL_WEBTASK_AUTH_TOKEN,
	} = context.secrets

	/* TOOLS */
	// Handle the webtask success callbacks
	const cblog = successMsg => {
		console.log(successMsg)
		cb(null, successMsg)
	}
	// Make the Graphcool requests less verbose
	const graphQLClient = new GraphQLClient(GRAPHCOOL_SIMPLE_API_END_POINT, {
		headers: {
			Authorization: `Bearer ${GRAPHCOOL_WEBTASK_AUTH_TOKEN}`,
		},
	})
	const rq = req => graphQLClient.request(req)
	// Make the Twilio requests less verbose
	const twilioClient = new Twilio(TWILIO_ACCT_SID, TWILIO_AUTH_TOKEN)
	const sendSMS = (smsBody, toNumber) => (
		twilioClient.messages.create({
			to: toNumber,
			from: TWILIO_PHONE,
			body: smsBody,
		}, error => error && cb(error))
	)

	const today = moment()
	const todayFormatted = today.format('MM/DD')
	rq(createQuestion(todayFormatted))
	let currentDay = today.add(1, 'days')
	while (todayFormatted !== currentDay.format('MM/DD')) {
		rq(createQuestion(currentDay.format('MM/DD')))
		currentDay = currentDay.add(1, 'days'))
	}

	cblog('added all questions')

	/* SEND DAILY MESSAGES */
	// rq(getMessageData)
	// 	.then(data => data.allUsers.forEach(user => sendSMS(
	// 		`Hey, ${user.firstName}! Today's question is:\n${data.Question.text}`,
	// 		user.phone
	// 	)))
	// 	.then(() => cblog(`Sent daily messages.`))
	// 	.catch(error => cb(error))
}
