'use latest'; // eslint-disable-line
/* RECEIVING SMS */
import Twilio from 'twilio'
import zipcodeToTimezone from 'zipcode-to-timezone'
import moment from 'moment-timezone'
import {GraphQLClient} from 'graphql-request'

console.log('Started qandaReceive')

/* GRAPHQL REQUESTS */
const getUserByPhone = phoneNum => (`{
	User(phone: "${phoneNum}") {
		id
		firstName
		accountSetupStage
		potentialPartnerPhone
		partner {
			id
			firstName
		}
		timezone
	}
}`)

const getTimezoneByZipcode = zipcode => zipcodeToTimezone.lookup(zipcode)
const createUser = (phoneNum, zipcode) => (`mutation {
	createUser(
		phone: "${phoneNum}"
		timezone: "${getTimezoneByZipcode(zipcode)}"
	) {
		id
	}
}`)

const setPartner = (user1Id, user2Id) => (`{
	setPartner(
		partner1UserId: "${user1Id}"
		partner2UserId: "${user2Id}"
	) {
		partner1User {
			id
		}
		partner2User {
			id
		}
	}
}`)

const getQuestionByDate = date => (`{
	Question(dateToAsk: "${date}") {
		id
		answers {
			text
			user {
				id
			}
		}
	}
}`)

const createAnswer = (text, questionID, userID) => (`{
	createAnswer(
		text: "${text}"
		questionId: "${questionID}"
		userId: "${userID}"
	) {
		id
	}
}`)

/* MODULE BODY */
export default (context, cb) => {
	const {data, secrets} = context

	/* MODIFIED DATA */
	// Modify the incoming data to grab message specifics
	const userMessage = data.Body
	const userMessageLC = userMessage.toLowerCase()
	// Check for common replies in the User's message
	const yes = userMessageLC.includes('yes') || userMessageLC === 'y'
	const no = userMessageLC.includes('no') || userMessageLC === 'n'

	/* ACCOUNT SECRETS */
	const {
		TWILIO_ACCT_SID,
		TWILIO_AUTH_TOKEN,
		TWILIO_PHONE,
		GRAPHCOOL_SIMPLE_API_END_POINT,
		GRAPHCOOL_WEBTASK_AUTH_TOKEN,
		WEBTASK_CONTAINER,
	} = secrets

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
	const rqThen = (req, then, then2, then3) => {
		if (then3) return rq(req).then(then).then(then2).then(then3).catch(error => cb(error))
		if (then2) return rq(req).then(then).then(then2).catch(error => cb(error))
		return rq(req).then(then).catch(error => cb(error))
	}
	// Make the Webtask requests less verbose
	const wt = require('webtask-require')(WEBTASK_CONTAINER) // eslint-disable-line global-require
	const startWebtask = (taskName, taskData) => wt(taskName, taskData)
		.then(result => cb(null, result))
		.catch(error => cb(error))
	// Make the Twilio requests less verbose
	const twilioClient = new Twilio(TWILIO_ACCT_SID, TWILIO_AUTH_TOKEN)
	const sendSMS = (smsBody, toNumber) => (
		twilioClient.messages.create({
			to: toNumber || data.From,
			from: TWILIO_PHONE,
			body: smsBody,
		}, error => error && cb(error))
	)

	/* HANDLE RECEIVED MESSAGE */
	rq(getUserByPhone(data.From))
		.then(userData => {
			const {User} = userData
			console.log('Successfully made the request for the user')

			// If there is a User connected to the phone number...
			if (User) {
				console.log('Found a user connected to the phone number')
				console.log(User)

				/* ACCOUNT SETUP */
				// Check if they've completed the account set up.
				if (User.accountSetupStage < 5) {
					console.log('Account setup is not complete; sending to Account Setup module')
					// If they haven't, send them and their message data over to account setup
					startWebtask('qandaAccountSetup', {User, userMessageData: data})
				}

				/* DASHBOARD */
				// If the user simply texted "help", tell them the available commands

				/* DAILY QUESTION */
				// Otherwise, assume the user sent in an answer to today's daily question
				// Grab today's date
				const currentDate = moment().tz(User.timezone)
				const today = `${currentDate.month() + 1}/${currentDate.date()}`
				// Get today's question
				rq(getQuestionByDate(today))
					// Use the user's message to create an answer for today's question
					.then(questionData => createAnswer(userMessage, questionData.id, User.id)
						.then(() => sendSMS(`Great. I'll share your answer with your partner.`))
						.then(() => {
							const partnerAnswer = questionData.answers.find(answer => answer.user.id === User.partner.id)
							if (partnerAnswer) {
								sendSMS(`${User.partner.id} answered with:\n\n${partnerAnswer.text}`)
							}
						})
						.then(() => sendSMS(`Send something about seeing previous years' responses.`))
						.catch(error => cb(error))
					)
					.catch(error => cb(error))
			} else if (yes) {
				/* ACCOUNT CREATION */
				// If there's not a User connected to the phone number,
				// and they answered "yes" to setting up an account,
				// create one for them
				rqThen(createUser(data.From, data.FromZip),
					sendSMS(`Fantastic! What's your first name?`),
					cblog(`Created new account and asked the new User's first name.`)
				)
				// The created "User" has a default "accountSetupStage" of 0,
				// So, when they reply, they will be routed to "qandaAccountSetup"
			} else if (no) {
				// If they answered "no" to setting up an account, thank them for their time
				sendSMS(`No problem. Hope you have a great day! Feel free to text me if you ever change your mind.`)
				cblog('Individual does not want to create a new account. Ended conversation.')
			} else {
				// Otherwise, act like this is the first time they've ever messaged
				// and ask them if they want to create an account
				sendSMS(`Welcome to Q&A, a simple SMS app that asks you daily questions and sends your answers to your partner. Q&A also saves your answers, year after year, so you can see how your answers have changed over time.\n\nWould you like me to create an account for you?\n(Reply "Yes" or "No")`)
				cblog('Welcomed new potential user. Asked if they wanted to create an account.')
			}

			// request(GRAPHCOOL_SIMPLE_API_END_POINT, createUser(data.From, data.FromZip))
			// 	.catch(error => cb(error))
			// // And send a welcome message out to the new user.
			// twilioClient.messages.create({
			// 	to: data.From,
			// 	from: TWILIO_PHONE,
			// 	body: "Welcome to Q&A, where you and your partners' answers to daily questions are texted to each other and saved for posterity. Tell me, what's your first name?",
			// }, (error, message) => {
			// 	if (error) {
			// 		cb(error)
			// 	} else {
			// 		messages.push(message)
			// 	}
			// })

			// /* PENDING PARTNER REQUEST */
			// // Check if they have a pending partner request...
			// if (User.pendingPartnerPhone) {
			// 	// ...Check to see if they accepted it or declined it.
			// 	if (body.contains('accept')) {
			// 		// If they accepted, get the Partner's data...
			// 		request(GRAPHCOOL_SIMPLE_API_END_POINT, getUserByPhone(User.pendingPartnerPhone))
			// 			.then(partnerData => {
			// 				const Partner = partnerData.User
			// 				// ...And set up the connection between the two Users.
			// 				request(GRAPHCOOL_SIMPLE_API_END_POINT, setPartner(User.id, Partner.id))
			// 					// Then send a message to both Users, signalling success.
			// 					.then(() => {
			// 						sendSMS(`Congrats! You and ${Partner.firstName} are connected. When either of you replies to a Daily Question, the other will be sent the answer. As the years go by, you'll also be reminded of previous years' answers. Have fun!`, User.phone)
			// 						sendSMS(`Congrats! ${User.firstName} accepted your partner request. When either of you replies to a Daily Question, the other will be sent the answer. As the years go by, you'll also be reminded of previous years' answers. Have fun!`, Partner.phone)
			// 					})
			// 					.catch(error => cb(error))
			// 			})
			// 	} else if (body.contains('decline')) {
			// 		// If they declined, send a message to the requester and delete the request.
			// 	} else {
			// 		// If their message doesn't accept or decline,
			// 		// ask them about the pending partner, again.
			// 	}
			// }

			// // Check for errors and send any with the callback.
			// if (errors.length > 0) {
			// 	cb(errors.toString())
			// // If there's none, send the messages with the callback.
			// } else {
			// 	cblog(messages.toString())
			// }
		})
		.catch(error => cb(error))
}
