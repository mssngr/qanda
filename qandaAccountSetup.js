/* ACCOUNT SETUP */
import Twilio from 'twilio'
import zipcodeToTimezone from 'zipcode-to-timezone'
import phone from 'phone'
import {request} from 'graphql-request'

/* Some useful functions for later */
const getTimezoneByZipcode = zipcode => zipcodeToTimezone.lookup(zipcode)

const getUserByPhone = phoneNum => (`{
	User(phone: "${phoneNum}") {
		id
		firstName
		partner
		timezone
	}
}`)

const updateAccountSetupStage = (id, newStage) => (`{
	updateUser(
		id: "${id}"
		accountSetupStage: ${newStage}
	) {
		id
	}
}`)

const updateUserFirstName = (id, firstName) => (`{
	updateUser(
		id: "${id}"
		firstName: "${firstName}"
		accountSetupStage: 1
	) {
		firstName
	}
}`)

const updateUserTimezone = (id, zipcode) => (`{
	updateUser(
		id: "${id}"
		timezone: "${getTimezoneByZipcode(zipcode)}"
	) {
		id
	}
}`)

/* Request received from qandaReceive */
export default (context, cb) => {

	// Data relating to the User's message
	const requestBody = context.body
	const {User, userMessageData} = requestBody
	const userMessage = userMessageData.Body
	const userMessageLC = userMessage.toLowerCase
	const userMessageDigits = userMessage.replace(/^\D+/g, '')

	// Checks for common replies in the User's message
	const yes = userMessageLC.includes('yes') || userMessageLC === 'y'
	const no = userMessageLC.includes('no') || userMessageLC === 'n'
	const zipcode = getTimezoneByZipcode(userMessageDigits) && userMessageDigits
	const phoneNumber = phone(userMessageDigits)[0]

	// Webtask Secrets
	const {
		TWILIO_ACCT_SID,
		TWILIO_AUTH_TOKEN,
		TWILIO_PHONE,
		GRAPHCOOL_SIMPLE_API_END_POINT,
	} = context.secrets

	// Containers for data that will be sent out with the webtask's callback
	const errors = []
	const messages = []

	// Some tools to make the Graphcool requests less verbose
	const rq = req => request(GRAPHCOOL_SIMPLE_API_END_POINT, req)
	const rqThen = (req, then) => rq(req).then(then).catch(error => errors.push(error))

	// Some tools to make the Twilio messages less verbose
	const twilioClient = new Twilio(TWILIO_ACCT_SID, TWILIO_AUTH_TOKEN)
	const sendSMS = (smsBody, toNumber) => (
		twilioClient.messages.create({
			to: toNumber || User.phone,
			from: TWILIO_PHONE,
			body: smsBody,
		}, (error, message) => {
			if (error) {
				errors.push(error)
			} else {
				messages.push(message)
			}
		})
	)

	// Let's see where the incoming User is in the account setup stage, and act accordingly.
	switch (User.accountSetupStage) {

		/* UPDATING FIRST NAME */
		case 0: {
			// Update their account and ask if we have their name down correctly.
			rq(updateUserFirstName(User.id, userMessage))
				.then(updatedUserData => sendSMS(`Nice to meet you, ${updatedUserData.User.firstName}. Did I spell your name correctly? (Reply "Yes" or "No")`))
				.catch(error => errors.push(error))
			break
		}

		/* CONFIRMING FIRST NAME */
		case 1: {
			// If their name is spelled correctly, move them forward in
			// the account setup stage and ask them about their zip code.
			if (yes) {
				rqThen(
					updateAccountSetupStage(User.id, 2),
					sendSMS(`Great! It looks like you're texting from the zipcode: ${userMessageData.FromZip}. That's important, because it tells me what timezone you're in (${User.timezone}.) Do I have the correct zipcode? (Reply "Yes" or "No")`)
				)
			} else if (no) {
				// If their name is not spelled correctly, move them backwards in
				// the account setup stage and ask their name again.
				rqThen(
					updateAccountSetupStage(User.id, 0),
					sendSMS('My apologies. How do you spell that, again?')
				)
			} else {
				// If we don't quite know how they responded, ask how we spelled their name, again.
				sendSMS(`I didn't quite catch that last message. I have your name down as ${User.firstName}. Is that spelled correctly? (Reply "Yes" or "No")`)
			}
			break
		}

		/* CONFIRMING ZIPCODE */
		case 2: {
			// If their zipcode is correct, update their account setup stage and ask the next question.
			if (yes) {
				rqThen(
					updateAccountSetupStage(User.id, 3),
					sendSMS('Great! Lastly, do you have a partner you want to share your answers with? (Reply "Yes" or "No)')
				)
			} else if (no) {
				// If their zipcode is not correct, ask them what their current zipcode is.
				sendSMS('Ok. What is your current, 5-digit zipcode, then?')
			} else if (zipcode) {
				// If they provided a zipcode as their reply, update their account and confirm it's correct.
				rqThen(
					updateUserTimezone(User.id, zipcode),
					sendSMS(`Wonderful. I have ${zipcode} as your zipcode, which means your timezone is ${getTimezoneByZipcode(zipcode)}. Is that correct? (Reply "Yes" or "No")`)
				)
			} else {
				// If we don't know how they replied, ask the question, again.
				sendSMS("I'm sorry, I didn't quite catch that. What's your current, 5-digit zipcode?")
			}
			break
		}

		/* PARTNER SETUP */
		case 3: {
			// If they do want to set up a partner, ask for their partner's phone number.
			if (yes) {
				sendSMS("That's just what this app was made for! What is your partner's 10-digit phone number? (e.g. 999-999-9999)")
			} else if (no) {
				// If they don't want to set up a partner, move them along in the account setup stage
				// and let them know the app can work for singles, as well.
				rqThen(
					updateAccountSetupStage(User.id, 4),
					sendSMS("That's ok. I'll save your answers just for you, and, as the years go by, you'll get to see how your answers differ over the years.")
				)
			} else if (phoneNumber) {
				// If they replied with a valid phone number,
				// check to see if the phone number is tied to an account.
				rq(getUserByPhone(phoneNumber))
					.then(partnerData => {
						const Partner = partnerData.User
						// If so, go ahead and set up the relation between the two Users.
						if (Partner) {
							request(GRAPHCOOL_SIMPLE_API_END_POINT, setPartner(User.id, Partner.id))
								// Then move them along the account setup stage.
								.then(() => {
									request(
										GRAPHCOOL_SIMPLE_API_END_POINT,
										moveAccountSetupStageForward(User.id, User.accountSetupStage)
									)
										// Then, finally, send them a message about the success, and ask today's question.
										.then(() => {

										})
								})
								.catch(error => errors.push(error))
						} else {
							// If the phone number is not tied to an account, send the potential partner
							// an invite to the service and move the account set up along.
							request(
								GRAPHCOOL_SIMPLE_API_END_POINT,
								moveAccountSetupStageForward(User.id, User.accountSetupStage)
							)
								.then(() => sendSMS(`${phoneNumber[0]} isn't tied to a user, yet. I sent them an invite to join. In the meantime, go ahead and answer today's question!`))
								.then(() => sendSMSElsewhere(phoneNumber[0], ''))
								.catch(error => errors.push(error))
						}
					})
					.catch(error => errors.push(error))
			} else {
				// If we don't know how they replied, ask the question, again.
				sendSMS("I'm sorry, I didn't quite catch that. Do you have a partner you want to share your answers with? (Reply \"Yes\" or \"No\")")
			}
			break
		}

		case 3: {
			// Check how they replied to the last message.
			const phoneNumber = phone(userMessage)
			// If they replied with a valid phone number,
			if (phoneNumber.length > 0) {
				// Check to see if the phone number is tied to an account.
				request(GRAPHCOOL_SIMPLE_API_END_POINT, getUserByPhone(phoneNumber[0]))
					.then(moreServerData => {
						const Partner = moreServerData.User
						// If so, go ahead and set up the connection between the two Users.
						if (Partner) {
							setPartner(User.id, Partner.id)
						} else {
							// If the phone number is not tied to an account, send the potential partner
							// an invite to the service and move the account set up along.
							request(
								GRAPHCOOL_SIMPLE_API_END_POINT,
								moveAccountSetupStageForward(User.id, User.accountSetupStage)
							)
								.then(() => sendSMS(`${phoneNumber[0]} isn't tied to a user, yet. I sent them an invite to join. In the meantime, go ahead and answer today's question!`))
								.then(() => sendSMSElsewhere(phoneNumber[0], ''))
								.catch(error => errors.push(error))
						}
					})
			}
			break
		}

		default: {
			twilioClient.messages.create({
				to: data.From,
				from: TWILIO_PHONE,
				body: "Welcome to Q&A, where you and your partners' answers to daily questions are texted to each other and saved for posterity. Tell me, what's your first name?",
			}, (error, message) => {
				if (error) {
					errors.push(error)
				} else {
					messages.push(message)
				}
			})
			break
		}
	}
}
