/* Request received from either qandaAccountSetup or qandaDashboard */
export default (context, cb) => {

	// Data relating to the User's message
	const requestBody = context.body
	const {Requester, Requestee} = requestBody
					// If so, see if that potential Partner already has a partner or a partner request
					if (Partner.partner || Partner.requestMade || Partner.requestReceived)
					sendSMS(`${Partner.firstName}, you have a request from ${User.firstName} (${User.phone}) to be Q&A partners! This means you will be able to see each other's answers to the daily questions. Also, you'll be able to see answers from years past. Would you like me to set up the connection?\n(Reply "Accept" or "Decline")`, Partner.phone)
