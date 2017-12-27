'use latest'; // eslint-disable-line
/* ACCOUNT SETUP */
import Twilio from 'twilio'
import zipcodeToTimezone from 'zipcode-to-timezone'
import phone from 'phone'
import {request} from 'graphql-request'

console.log('Started qandaAccountSetup')

/* GRAPHQL REQUESTS */
const getUserByPhone = phoneNum => (`{
	User(phone: "${phoneNum}") {
		id
		firstName
		partner
		requestMade
		requestReceived
		timezone
	}
}`)

const updateAccountSetupStage = (id, newStage) => (`mutation {
	updateUser(
		id: ${id}
		accountSetupStage: ${newStage}
	) {
		id
	}
}`)

const updateUserFirstName = (id, firstName) => (`mutation {
	updateUser(
		id: ${id}
		firstName: ${firstName}
		accountSetupStage: 1
	) {
		firstName
	}
}`)

const getTimezoneByZipcode = zipcode => zipcodeToTimezone.lookup(zipcode)
const updateUserTimezone = (id, zipcode) => (`mutation {
	updateUser(
		id: ${id}
		timezone: "${getTimezoneByZipcode(zipcode)}"
	) {
		id
	}
}`)

const createPartnership = (PartnershipRequest) => (`mutation {
	setParter(
		partner1UserId: ${PartnershipRequest.requestee.id}
		partner2UserId: ${PartnershipRequest.requester.id}
	) {
		id
	}
}`)

const createPartnershipRequest = (requesterId, requesteeId) => (`mutation {
	createPartnershipRequeset(
		requesterId: ${requesterId}
		requesteeId: ${requesteeId}
	) {
		id
	}
}`)

const deletePartnershipRequest = (partnershipRequestId) => (`mutation {
	deletePartnershipRequest(id: ${partnershipRequestId}) {
		id
	}
}`)

/* MODULE BODY */
export default (context, cb) => {

	/* MODIFIED DATA */
	// Modify the incoming data to grab message specifics
	const requestBody = context.body
	const {User, userMessageData} = requestBody
	const userMessage = userMessageData.Body
	const userMessageLC = userMessage.toLowerCase()
	const userMessageDigits = userMessage.replace(/^\D+/g, '')
	// Check for common replies in the User's message
	const yes = userMessageLC.includes('yes') || userMessageLC === 'y'
	const no = userMessageLC.includes('no') || userMessageLC === 'n'
	const zipcode = getTimezoneByZipcode(userMessageDigits) && userMessageDigits
	const phoneNumber = phone(userMessageDigits)[0]

	/* ACCOUNT SECRETS */
	const {
		TWILIO_ACCT_SID,
		TWILIO_AUTH_TOKEN,
		TWILIO_PHONE,
		GRAPHCOOL_SIMPLE_API_END_POINT,
	} = context.secrets

	/* STORAGE FOR RESULTS OF WEBTASK */
	const errors = []
	const messages = []

	/* TOOLS */
	// Make the Graphcool requests less verbose
	const rq = req => request(GRAPHCOOL_SIMPLE_API_END_POINT, req)
	const rqThen = (req, then, then2, then3) => {
		if (then3) return rq(req).then(then).then(then2).then(then3).catch(error => errors.push(error))
		if (then2) return rq(req).then(then).then(then2).catch(error => errors.push(error))
		return rq(req).then(then).catch(error => errors.push(error))
	}
	// Make the Twilio requests less verbose
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

	/* HANDLE RECEIVED MESSAGE */
	// Let's see where the incoming User is in the account setup stage, and act accordingly.
	switch (User.accountSetupStage) {

		/* UPDATING FIRST NAME */
		case 0: {
			// Update their account and ask if we have their name down correctly.
			rq(updateUserFirstName(User.id, userMessage))
				.then(updatedUserData => sendSMS(`Nice to meet you, ${updatedUserData.User.firstName}. Did I spell your name correctly?\n(Reply "Yes" or "No")`))
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
					sendSMS(`Great! It looks like you're texting from the zipcode: ${userMessageData.FromZip}. That's important, because it tells me what timezone you're in (${User.timezone}.) Do I have the correct zipcode?\n(Reply "Yes" or "No")`)
				)
			} else if (no) {
				// If their name is not spelled correctly, move them backwards in
				// the account setup stage and ask their name again.
				rqThen(
					updateAccountSetupStage(User.id, 0),
					sendSMS(`My apologies. How do you spell that, again?`)
				)
			} else {
				// If we don't quite know how they responded, ask how we spelled their name, again.
				sendSMS(`I didn't quite catch that last message. I have your name down as ${User.firstName}. Is that spelled correctly?\n(Reply "Yes" or "No")`)
			}
			break
		}

		/* CONFIRMING ZIPCODE */
		case 2: {
			// If their zipcode is correct, update their account setup stage and ask the next question.
			if (yes) {
				rqThen(
					updateAccountSetupStage(User.id, 3),
					sendSMS(`Great! Lastly, do you have a partner you want to share your answers with?\n(Reply "Yes" or "No")`)
				)
			} else if (no) {
				// If their zipcode is not correct, ask them what their current zipcode is.
				sendSMS(`Ok. What is your current, 5-digit zipcode, then?`)
			} else if (zipcode) {
				// If they provided a zipcode as their reply, update their account and confirm it's correct.
				rqThen(
					updateUserTimezone(User.id, zipcode),
					sendSMS(`Wonderful. I have ${zipcode} as your zipcode, which means your timezone is ${getTimezoneByZipcode(zipcode)}. Is that correct?\n(Reply "Yes" or "No")`)
				)
			} else {
				// If we don't know how they replied, ask the question, again.
				sendSMS(`I'm sorry, I didn't quite catch that. What's your current, 5-digit zipcode?`)
			}
			break
		}

		/* CONFIRMING PARTNER REQUEST */
		case 3: {
			// If they do want to set up a partner, ask for their partner's phone number.
			if (yes) {
				sendSMS(`That's just what this app was made for! What is your partner's 10-digit phone number? (e.g. 999-999-9999)`)
			} else if (no) {
				// If they don't want to set up a partner, skip them to the end of the account setup stage
				// and let them know the app can work for singles, as well.
				rqThen(
					updateAccountSetupStage(User.id, 5),
					sendSMS(`That's ok. I'll save your answers just for you, and, as the years go by, you'll get to see how your answers differ.\n\nIf you ever want to change your settings, just text "Dashboard" to this number. Also, texting "Help" will give you a list of all the available commands. Anyways, let's get on to the fun stuff! I'll send you today's question.`), // eslint-disable-line quotes
					null // filler, I'll want to send the daily question with this line.
				)
			} else if (phoneNumber) {
				// If they replied with a valid phone number,
				// update the account setup stage and confirm
				// that's the number the User wants to partner with.
				rqThen(
					updateAccountSetupStage(User.id, 4),
					sendSMS(`Ok, just confirming. You want to send a partnership request to ${phoneNumber}?`)
				)
			} else {
				// If we don't know how they replied, ask the question, again.
				sendSMS(`I'm sorry, I didn't quite catch that. Do you have a partner you want to share your answers with?\n(Reply "Yes" or "No")`) // eslint-disable-line quotes
			}
			break
		}

		/* SENDING PARTNERSHIP REQUEST */
		case 4: {
			// If they confirm the phone number, check to see if it's tied to an account.
			if (yes) {
				rq(getUserByPhone(phoneNumber))
					.then(partnerData => {
						const Partner = partnerData.User

						// THERE IS A USER
						if (Partner) {
							const {partner, requestMade, requestReceived} = Partner
							// If so, see if that potential Partner already has a partner or a partnership request
							if (partner || requestMade || requestReceived) {

								// POTENTIAL PARTNERSHIP EXISTS
								// If they do have a partnership set up or in process,
								// check to see if it is with the User
								if (partner && partner.id === User.id) {

									// POTENTIAL PARTNER IS PARTNERS WITH USER
									// If the two users already have a partnership, let the new User know
									// and move the User to the end of the account setup stage
									rqThen(
										updateAccountSetupStage(User.id, 5),
										sendSMS(`Hey ${User.firstName}, it looks like you already have a partnership set up with ${Partner.firstName}! That means you both will be able to see each others' answers to the daily questions. And, as time goes by, you'll both be reminded of answers from years past.\n\nIf you ever want to change your settings, just text "Dashboard" to this number. Also, texting "Help" will give you a list of all the available commands. Anyways, let's get on to the fun stuff! I'll send you today's question.`)
									)
								} else if (requestMade && requestMade.requestee.id === User.id) {

									// POTENTIAL PARTNER MADE PARTNERSHIP REQUEST TO USER
									// If the potential partner already requested partnership with the User,
									// cement the partneship
									rqThen(
										createPartnership(requestMade),
										deletePartnershipRequest(requestMade.id),
										updateAccountSetupStage(User.id, 5),
										sendSMS(`I was able to set up the partnership with ${Partner.firstName}! That means you both will be able to see each others' answers to the daily questions. And, as time goes by, you'll both be reminded of answers from years past.\n\nIf you ever want to change your settings, just text "Dashboard" to this number. Also, texting "Help" will give you a list of all the available commands. Anyways, let's get on to the fun stuff! I'll send you today's question.`)
									)
								} else if (requestReceived && requestReceived.requester.id === User.id) {

									// POTENTIAL PARTNER RECEIVED PARTNERSHIP REQUEST FROM USER
									// If the potential partner already has received a request for partnership
									// from the user, let the User know it is still pending
									// and finish their account set up
									rqThen(
										updateAccountSetupStage(User.id, 5),
										sendSMS(`${User.firstName}, it looks like you already sent a request to that number. Once your partner accepts your request, you both will be able to see each others' answers to the daily questions. And, as time goes by, you'll both be reminded of answers from years past.\n\nIf you ever want to change your settings, just text "Dashboard" to this number. Also, texting "Help" will give you a list of all the available commands. Anyways, let's get on to the fun stuff! I'll send you today's question.`)
									)
								} else {

									// POTENTIAL PARTNER HAS EXISTING PARTNERSHIP OR PARTNERSHIP REQUEST
									// TO SOMEONE ELSE
									// If the potential partner has an existing partnership
									// or a pending partnership request with someone else,
									// notify the potential Partner and User,
									// and finish the User's account setup
									sendSMS(
										`Hello, it looks like ${User.firstName} tried to request a Q&A partnership with you, but it seems you already have either an existing partner or an existing partnership request pending. Contact gabriel@ecliptic.io if this is a mistake.`,
										Partner.phone
									)
									rqThen(
										updateAccountSetupStage(User.id, 5),
										sendSMS(`I'm sorry, ${User.firstName}, I'm unable to process the partner request. Contact the person you're trying to connect with to see if they have their account set up to receive a partner.`)
									)
								}
							} else {

								// NO PARTNERSHIPS EXIST WITH POTENTIAL PARTNER
								// If the potential partner has no existing partnership ties,
								// set up the request for partnership between the two users,
								// notify both users, and move the User along account setup
								rqThen(
									createPartnershipRequest(User.id, Partner.id),
									sendSMS(
										`${Partner.firstName}, you have a request from ${User.firstName} (${User.phone}) to be Q&A partners! This means you will be able to see each other's answers to the daily questions. Also, you'll be able to see answers from years past. Would you like me to set up the connection?\n(Reply "Accept" or "Decline")`,
										Partner.phone
									)
								)
								rqThen(
									updateAccountSetupStage(User.id, 5),
									sendSMS(`${User.firstName}, I sent a partnership request to that phone number. Once your partner accepts your request, you both will be able to see each others' answers to the daily questions. And, as time goes by, you'll both be reminded of answers from years past.\n\nIf you ever want to change your settings, just text "Dashboard" to this number. Also, texting "Help" will give you a list of all the available commands. Anyways, let's get on to the fun stuff! I'll send you today's question.`)
								)
							}
						} else {

							// NO ACCOUNT EXISTS WITH PHONE NUMBER
							// If the phone number is not tied to an account,
							// send the potential partner an invite to the service
							// and finish the User's account setup
							/* NEED TO FIGURE OUT HOW TO CREATE REQUEST WITHOUT ACCOUNT */
							'Finish this Section'
							sendSMS(
								`Hello! ${User.firstName} sent you an invite to be their partner in a simple SMS app called "Q&A." Q&A sends you daily questions and, when you answer them, sends your answers to your partner (and vice versa.) It's a fun way to get to know each other better. Would you like me to set up an account for you?\n(Reply "Create account")`,
								phoneNumber
							)
							rqThen(
								updateAccountSetupStage(User.id, 5),
								sendSMS(`${User.firstName}, I sent a partnership request to that phone number. Once your partner accepts your request, you both will be able to see each others' answers to the daily questions. And, as time goes by, you'll both be reminded of answers from years past.\n\nIf you ever want to change your settings, just text "Dashboard" to this number. Also, texting "Help" will give you a list of all the available commands. Anyways, let's get on to the fun stuff! I'll send you today's question.`)
							)
						}
					})
					// Also, send the User today's question.
					.then(() => null) // filler, I'll want to send the daily question with this line.
					.catch(error => errors.push(error))
				'Finish this Section'
			} else if (no) {
				// If they do not confirm the number, put them back to the previous stage
				// and ask if they want to do a partnership request, at all.
				rqThen(
					updateAccountSetupStage(User.id, 3),
					sendSMS(`Oh, ok! Did you still want to set up a partnership request with someone?\n(Reply "Yes" or "No")`)
				)
			} else {
				// If we don't know what they said, ask again.
				sendSMS(`Sorry, didn't quite catch that. Just confirming: you want to send a partnership request to ${phoneNumber}?`)
			}
			break
		}

		default: {
			errors.push('Account setup stage is incorrect.')
			sendSMS(`I'm sorry, ${User.firstName}. It looks like there's something wrong with your account. 🙁 Please contact gabriel@ecliptic.io, letting him know your "account setup stage" is not saved correctly.`)
			break
		}
	}

	// Check for errors and send any with the callback.
	if (errors.length > 0) {
		cb(errors.toString)
	// If there's none, send the messages with the callback.
	} else {
		cb(null, messages.toString)
	}
}
